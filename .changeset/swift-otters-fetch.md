---
"dalux-build-api": patch
---

Add file download support to the JavaScript client: `FilesApi.downloadFileBuffer` fetches a file's bytes without writing to disk, and `FileRevisionsApi.getFileRevisionContent` now correctly returns binary content (it previously mishandled it under axios's default JSON responseType). The playground console can now download files and file revisions directly to the browser.
