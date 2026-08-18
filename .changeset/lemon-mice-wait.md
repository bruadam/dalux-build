---
"dalux-build-api": patch
---

fix: add comprehensive sidebar filters, user/company name resolution, and response deadline coloring to task timeline dashboard

Added new filter controls in the sidebar for the tasks_timeline dashboard:
- Assignee filter (multiselect)
- Company filter (multiselect) - filters by user's company
- Created date range filter (slider)
- Deadline date range filter (slider)

Updated the filter_timeline_records function to support these new filters, ensuring that all table columns can now be filtered through the sidebar. This addresses issue #22 where filters on Streamlit tables should also drive the Graphs data, as all filtering is now done through explicit sidebar controls that affect both the table and graph displays.

Additionally, implemented user and company name resolution:
- User names are resolved from the users API (first_name + last_name)
- Company names are resolved from the companies API
- Both are displayed in the table and graph hover information

Added response deadline configuration:
- Configurable response deadline in business days (default 10 days)
- Message exchanges (transitions from assign to completion) that exceed the deadline are highlighted in red in the graph
- Transitions within the deadline are shown in blue
- Uses business day calculation excluding weekends and Danish holidays (when holidays library is available)

BREAKING CHANGE: The filter_timeline_records function signature has been updated to include new optional parameters for companies filtering. The build_timeline_records function now accepts user_company_map and company_name_map parameters for name resolution. The build_figure function now accepts a response_deadline_days parameter.
