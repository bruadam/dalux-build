---
"dalux-build-api": patch
---

Improve Python webhook monitor observability and testing ergonomics by adding `WebhookServerApi.test_job()` (plus `test_webhook()` alias), periodic scheduler job snapshot logging, and explicit queue/send/success/failure logs for callback delivery attempts. Also update webhook docs and tests to cover the new behavior.
