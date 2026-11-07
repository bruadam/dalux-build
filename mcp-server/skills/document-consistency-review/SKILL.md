---
name: document-consistency-review
description: Method for cross-checking all documents in a Dalux scope (contract, tender material, descriptions, drawings, schedules, bills of quantities) for contradictions in values, quantities, dates, references, revisions and responsibilities, using check_document_consistency, list_inconsistencies and export_inconsistency_report, and for producing a cited findings register. Use when the user asks for a consistency check, a document review, "modstrid", "uoverensstemmelser", a tender review (udbudsgennemgang) or a projektgennemgang.
metadata:
  tags: [documents, consistency, quality-assurance, tender-review, denmark, construction]
---

# Document consistency review

Goal: find every place where two or more documents of a scope say different things about the same thing,
decide which ones are real, and deliver a **findings register**: one finding per contradiction, every
statement cited with file, location and verbatim quote, exported as a separate document.

Danish terms for this work: **modstrid** (conflict), **uoverensstemmelse** (inconsistency),
**projektgennemgang** (design/document review), **udbudsgennemgang** (tender review).

For Danish contract documents, document types and the precedence rules, read the
`danish-construction-contracts` skill first (`get_skill`). This skill does not repeat them.

## Ground rules

- Nothing here changes Dalux. The report is a local document returned to the user; it is never uploaded.
- Every statement in a finding needs file name, location (page, sheet/row, section) and a verbatim quote in
  the source language. No quote, no finding.
- A finding needs at least two statements from different files. A contradiction inside one file is
  reported separately in your answer, not as a register finding.
- Report what the documents say. Say which document prevails only when the precedence is clear, and cite
  the precedence clause. Otherwise state the open question.
- Coverage is part of the result. Always report files that were skipped or could not be read.

## Tools

| Tool | Use |
| --- | --- |
| `check_document_consistency({ projectId, fileAreaId, folderPath?, fileIds?, extensions?, focus?, maxFiles?, timeBudgetSeconds?, useModel? })` | Runs the check over the scope. Returns `{ reportId, complete, filesInScope, filesAnalyzed, skipped[], findingsCount, bySeverity, topFindings[], warnings[] }`. |
| `list_inconsistencies({ reportId, severity?, type?, fileId?, offset?, limit? })` | Pages through findings: `{ total, findings[] }`. |
| `export_inconsistency_report({ reportId, format })` | Returns the register as `xlsx`, `docx`, `md` or `annotated-pdf` (zip of highlighted PDFs plus the xlsx), the same way `download_file` returns files. |
| `list_consistency_reports()` / `drop_consistency_report({ reportId })` | See or delete cached reports. |
| `search_file_content`, `search_file_area`, `render_pdf_page` | Follow-up: read the exact passage, find more statements on the same subject, look at drawing geometry. |
| `list_files`, `get_file`, `search_files_by_name` | Find the files and revisions in scope; check the drawing register against what exists. |

Notes on `check_document_consistency`:

- It is resumable and budgeted, like `build_file_area_index`. The same arguments give the same `reportId`.
  While `complete` is `false`, call it again with **exactly the same arguments**. Changing arguments starts
  a different report.
- It is incremental per file revision: after documents are revised, run it again with the same arguments
  to update the report.
- Use `focus` to steer it to a subject (e.g. "fire classification", "deadlines and dagbod") and
  `extensions` / `folderPath` / `fileIds` to narrow the scope. Read the tool description for what `useModel`
  does on this server before relying on it.
- `skipped[]` lists files it could not analyse (unsupported formats such as `.dwg`/`.ifc`, scanned PDFs without
  a text layer, extraction errors). These are blind spots: list them in your answer.

A finding has this shape:

```
{ id, type: value_conflict | quantity_conflict | date_conflict | reference_conflict | revision_conflict | other,
  severity: high | medium | low, subject, attribute, summary, verdict: confirmed | candidate,
  explanation?, precedenceNote?,
  statements: [{ fileId, fileName, revisionId?, location, quote, value? }, ...] }
```

`verdict: candidate` means not yet verified. Never present a candidate as confirmed without checking it.

## Method

### 1. Fix the scope and the precedence

1. Agree the scope with the user: project, file area, folder(s), and whether it is the tender material, the
   contract documents or the current execution documents. Mixed phases (**udbudsprojekt** vs.
   **udførelsesprojekt**) produce many false conflicts; keep them apart or note the phase per file.
2. Find the contract documents list (**aftalegrundlag**) and any precedence clause (**rangorden**,
   **prioritetsrækkefølge**) in the contract, særlige betingelser or tender letter. Quote it. If there is none,
   use the default from the `danish-construction-contracts` skill and say so.
3. Find the document register (**tegningsliste**, **dokumentliste**) with the current revision of each
   document.

### 2. Run the check

1. Call `check_document_consistency` for the scope. Repeat with the same arguments until `complete` is `true`.
   Tell the user the progress (`filesAnalyzed` / `filesInScope`) on long runs.
2. Note `skipped[]` and `warnings[]`.
3. Page through all findings with `list_inconsistencies`, high severity first. Do not stop at `topFindings`.

### 3. Judge each candidate

For each finding, open every cited location (`search_file_content` with the quote or subject, or
`render_pdf_page` for a drawing) and answer these questions in order:

1. **Same element?** Do both statements refer to the same building part, room, item or obligation? Check
   identifiers: room number, axis/grid line (**akse**), level (**etage**, **kote**), CCS code, item number in
   the tilbudsliste, door/window type. Same word, different element is not a conflict.
2. **Same context?** Same phase, same building/stage (**etape**), same trade contract (**fagentreprise**),
   same condition (e.g. temporary vs. final state, fire case vs. normal case)?
3. **Same quantity after normalisation?** Convert units and Danish number formats (see traps below). Is one
   value a range, minimum or maximum that the other satisfies?
4. **Superseded?** Is one statement in an older revision, a withdrawn document (**udgået**, **erstattet af**),
   or overridden by a later **rettelsesblad**, Q&A answer or agreed minute? If so it is a
   `revision_conflict` only if the old version is still listed as valid somewhere (register, contract list).
5. **Which document prevails?** Apply the project's precedence clause, else the default order. Within one
   group (e.g. drawing vs. description) there is no fixed rule; name the conflict and the principles that
   apply (specific before general, project-specific before standard text, newer before older). Write this in
   your notes for `precedenceNote`.
6. **Verdict.** Confirmed (real contradiction, quotes checked), dismissed (explain why), or needs a person
   (you cannot tell without a drawing, model, or the author). Look for further statements on the same subject
   with `search_file_area`; a third document often decides it.

### 4. Check what the tool cannot see

Do a short manual pass for:

- Drawing register vs. files: drawings listed but missing, files present but not listed, revision letters
  that differ between register, title block (**tegningshoved**) and file name.
- Deadlines: contract vs. hovedtidsplan vs. tender letter vs. BSB (start, completion, milestones, handover).
- Contract terms stated in several places: dagbod rate, security percentage, payment period, insurance,
  warranty and inspection dates.
- Responsibility: who designs, supplies or installs an element (**ansvarsfordeling**, **grænseflader**,
  **bygherreleverance**) in BSB vs. trade descriptions vs. tilbudsliste.
- References: "jf. afsnit 3.4", "se tegning A-201", "iht. DS/EN …" pointing to a section, drawing or standard
  edition that does not exist or was superseded.
- Files in `skipped[]` that are likely important (scanned contracts, drawings only in `.dwg`).

Add what you find as extra findings in your answer, with the same citation standard.

## Finding types

| Type | Examples |
| --- | --- |
| `value_conflict` | Fire class EI 60 vs. EI 30 for the same wall; concrete class; U-value; colour; product. |
| `quantity_conflict` | Tilbudsliste 1.250 m² vs. drawing area 1.320 m²; number of doors per type. |
| `date_conflict` | Completion date in contract vs. hovedtidsplan; inspection dates; tender deadlines. |
| `reference_conflict` | A description refers to a drawing, section or standard that does not exist or says something else. |
| `revision_conflict` | Register lists rev. C, the file in Dalux is rev. D; two revisions both marked as valid. |
| `other` | Responsibility conflicts, contract-term conflicts that are not a single value. |

## Severity

- **high**: changes price, time, safety or legal position. Examples: structural, fire or safety values;
  deadlines and dagbod; security, payment and insurance terms; scope that one document includes and another
  excludes; conflicts between contract-level documents with no clear precedence.
- **medium**: affects quantities, materials or coordination but has a clear fix or precedence. Examples:
  quantity differences in the tilbudsliste; product or finish differences; outdated standard edition.
- **low**: editorial or with no practical effect. Examples: naming differences for clearly the same item;
  broken references with an obvious target; formatting of dates.

Raise the severity if the conflict sits in documents that are part of the signed contract, or if the
lower-ranked document is the one the site will actually use (e.g. the drawing).

## False-positive traps

- **Danish number format**: decimal comma and thousands point. "1.250" is one thousand two hundred and fifty;
  "1,250" is one and a quarter. "12,5 m" = 12.5 m. Check the column format in Excel files.
- **Units**: mm on drawings, m in descriptions, m² vs. m³, kN vs. kN/m², "stk." (pieces), "lbm" (running metres),
  "c/c" (centre to centre). Normalise before comparing.
- **Levels (koter)**: "+12,350" is a level in metres; compare against the same datum (**DVR90** or a local zero).
- **Dates**: "03.04.2026" and "03-04-2026" are 3 April 2026 (day first). Week numbers ("uge 14") are common in
  schedules; convert before comparing. Working days (**arbejdsdage**) vs. calendar days (**løbedage**) change
  deadlines.
- **Ranges and limits**: "min. 100 mm" and "120 mm" do not conflict; "maks. 100 mm" and "120 mm" do.
  Also "ca." (approximately), "±", "op til" (up to), "mindst" (at least), "højst" (at most).
- **Typical vs. specific**: "typisk", "generelt", "medmindre andet er angivet" (unless otherwise stated),
  standard details vs. a specific detail. The specific statement usually governs; this is not a conflict
  unless the specific one is ambiguous.
- **Options and alternatives**: **option**, **alternativ**, **tilvalg**, **fravalg** items in the tilbudsliste
  are not the base scope.
- **Different phases or stages**: udbud vs. udførelse, etape 1 vs. etape 2, existing vs. new (**eksisterende**,
  **ny**), demolition (**nedrivning**) drawings.
- **Superseded revisions** still in the file area: check status and register before reporting.
- **Text extraction**: drawing text layers mix up title blocks and annotations; tables in PDFs lose columns.
  Confirm a doubtful quote with `render_pdf_page`.

## Required output

1. Call `export_inconsistency_report({ reportId, format })`. Default to `xlsx` for a register the user will
   filter and assign; use `docx` for a review memo and `md` for a quick look in chat. Give the user the file.
   For the user, prefer `export_inconsistency_report` with `format: 'annotated-pdf'`. It returns a zip with each
   affected PDF, where every quoted statement is highlighted and has a comment naming the conflicting value and
   where it is. The xlsx register is included. Report `unmatchedQuotes` (quotes shown as a page note instead of a
   highlight) and any PDFs listed as not annotated (e.g. encrypted).
2. In your answer, summarise:
   - scope, precedence used (quoted, with location), and coverage: `filesAnalyzed` of `filesInScope`, the
     skipped files and why;
   - counts by severity and type;
   - the high-severity findings, each with its statements (file, location, quote) and your verdict;
   - candidates you dismissed and why (they stay in the exported report, so list them), and findings from your manual pass that are not in the exported report;
   - open questions for the project team (**spørgsmål til projekterende**).
3. One finding per contradiction. If three documents disagree on one value, that is one finding with three
   statements, not three findings.

Minimum content per register row: ID, severity, type, subject, attribute, summary, verdict, per statement
file / revision / location / quote / value, explanation, precedence note.
