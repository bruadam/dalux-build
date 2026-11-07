import { Action, ActionPanel, Icon, List, openExtensionPreferences } from "@raycast/api";
import { ApiError, AuthenticationError, NotFoundError, RateLimitError } from "dalux-build-api";
import { PreferencesError } from "./client";

export function describeError(error: Error): { title: string; description: string; icon: Icon } {
  if (error instanceof PreferencesError) {
    return { title: "Check the extension preferences", description: error.message, icon: Icon.Gear };
  }
  if (error instanceof AuthenticationError) {
    return {
      title: "Invalid API key",
      description: "Dalux rejected the API key. Check the API key and the API Base URL in the preferences.",
      icon: Icon.Lock,
    };
  }
  if (error instanceof NotFoundError) {
    return {
      title: "Not found or no access",
      description: "Dalux could not find this resource, or the API key has no access to it.",
      icon: Icon.EyeDisabled,
    };
  }
  if (error instanceof RateLimitError) {
    return {
      title: "Rate limited",
      description: "Dalux is rate limiting requests. Try again in a minute.",
      icon: Icon.Clock,
    };
  }
  if (error instanceof ApiError && /\b403\b|forbidden|access/i.test(error.message)) {
    return { title: "No access", description: error.message, icon: Icon.EyeDisabled };
  }
  return { title: "Could not load data from Dalux", description: error.message, icon: Icon.Warning };
}

export function ErrorView({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { title, description, icon } = describeError(error);
  return (
    <List.EmptyView
      icon={icon}
      title={title}
      description={description}
      actions={
        <ActionPanel>
          {onRetry && <Action title="Retry" icon={Icon.ArrowClockwise} onAction={onRetry} />}
          <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
