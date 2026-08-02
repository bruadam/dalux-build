UPDATE public.audit_logs
SET
	old_values = old_values - 'api_key' - 'secret_id',
	new_values = new_values - 'api_key' - 'secret_id'
WHERE resource_type = 'dalux_credential'
  AND (
	  old_values ?| ARRAY['api_key', 'secret_id']
	  OR new_values ?| ARRAY['api_key', 'secret_id']
  );
