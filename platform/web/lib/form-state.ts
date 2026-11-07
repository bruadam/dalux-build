/** Result of a form server action: an error to show, or a secret to show once. */
export interface FormState {
  error?: string;
  secret?: { label: string; value: string };
  done?: boolean;
}
