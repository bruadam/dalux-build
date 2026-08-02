CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.dalux_credentials
	ADD COLUMN secret_id UUID REFERENCES vault.secrets(id);

DO $$
DECLARE
	credential RECORD;
	created_secret_id UUID;
BEGIN
	FOR credential IN
		SELECT id, api_key
		FROM public.dalux_credentials
	LOOP
		SELECT vault.create_secret(
			credential.api_key,
			'dalux-credential-' || credential.id::TEXT,
			'Dalux API key'
		) INTO created_secret_id;

		UPDATE public.dalux_credentials
		SET secret_id = created_secret_id
		WHERE id = credential.id;
	END LOOP;
END;
$$;

ALTER TABLE public.dalux_credentials
	ALTER COLUMN secret_id SET NOT NULL,
	DROP COLUMN api_key;

CREATE OR REPLACE FUNCTION public.create_dalux_credential_secret(
	p_user_id UUID,
	p_name TEXT,
	p_api_key TEXT,
	p_base_url TEXT,
	p_dalux_user_id TEXT DEFAULT NULL,
	p_description TEXT DEFAULT NULL
)
RETURNS public.dalux_credentials
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	created_secret_id UUID;
	created_credential public.dalux_credentials;
BEGIN
	IF p_api_key IS NULL OR btrim(p_api_key) = '' THEN
		RAISE EXCEPTION 'API key is required' USING ERRCODE = '22023';
	END IF;

	IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
		RAISE EXCEPTION 'User not found' USING ERRCODE = '22023';
	END IF;

	SELECT vault.create_secret(
		p_api_key,
		'dalux-credential-' || gen_random_uuid()::TEXT,
		'Dalux API key'
	) INTO created_secret_id;

	INSERT INTO public.dalux_credentials (
		user_id,
		name,
		dalux_user_id,
		secret_id,
		base_url,
		description
	) VALUES (
		p_user_id,
		p_name,
		p_dalux_user_id,
		created_secret_id,
		p_base_url,
		p_description
	)
	RETURNING * INTO created_credential;

	RETURN created_credential;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dalux_credential_secret(
	p_credential_id UUID,
	p_user_id UUID
)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
	SELECT decrypted.decrypted_secret
	FROM public.dalux_credentials AS credential
	JOIN vault.decrypted_secrets AS decrypted ON decrypted.id = credential.secret_id
	WHERE credential.id = p_credential_id
	  AND credential.user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.update_dalux_credential_secret(
	p_credential_id UUID,
	p_user_id UUID,
	p_api_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	credential_secret_id UUID;
BEGIN
	IF p_api_key IS NULL OR btrim(p_api_key) = '' THEN
		RAISE EXCEPTION 'API key is required' USING ERRCODE = '22023';
	END IF;

	SELECT secret_id INTO credential_secret_id
	FROM public.dalux_credentials
	WHERE id = p_credential_id
	  AND user_id = p_user_id;

	IF credential_secret_id IS NULL THEN
		RAISE EXCEPTION 'Dalux credential not found' USING ERRCODE = 'P0002';
	END IF;

	PERFORM vault.update_secret(credential_secret_id, p_api_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_dalux_credential_secret(
	p_credential_id UUID,
	p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	credential_secret_id UUID;
BEGIN
	DELETE FROM public.dalux_credentials
	WHERE id = p_credential_id
	  AND user_id = p_user_id
	RETURNING secret_id INTO credential_secret_id;

	IF credential_secret_id IS NULL THEN
		RAISE EXCEPTION 'Dalux credential not found' USING ERRCODE = 'P0002';
	END IF;

	DELETE FROM vault.secrets WHERE id = credential_secret_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_dalux_credential_secret(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dalux_credential_secret(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_dalux_credential_secret(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_dalux_credential_secret(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_dalux_credential_secret(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dalux_credential_secret(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_dalux_credential_secret(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_dalux_credential_secret(UUID, UUID) TO service_role;

REVOKE ALL ON public.dalux_credentials FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.dalux_credentials FROM authenticated;
GRANT SELECT (
	id,
	user_id,
	name,
	dalux_user_id,
	base_url,
	is_active,
	is_default,
	description,
	created_at,
	updated_at
) ON public.dalux_credentials TO authenticated;
GRANT UPDATE (
	name,
	dalux_user_id,
	base_url,
	is_active,
	is_default,
	description
) ON public.dalux_credentials TO authenticated;

COMMENT ON COLUMN public.dalux_credentials.secret_id IS 'Reference to the encrypted Dalux API key in Supabase Vault';
COMMENT ON FUNCTION public.get_dalux_credential_secret(UUID, UUID) IS 'Returns a Dalux API key to trusted service-role callers after credential ownership filtering';
