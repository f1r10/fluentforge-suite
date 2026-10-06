# EduFlow Platform

Build a production-grade web platform for one private teacher and the teacher’s students.
This is NOT a simple multiple-choice quiz website. It is a complete Language Learning Content Management, Practice, Examination, Document Import, Student Monitoring and Analytics platform.
The first deployment is for one teacher, but the internal data model must be clean enough to support future expansion.
The platform must not be hard-coded specifically for English. Initially the interface must support Azerbaijani, English, Russian and Turkish, while learning content may belong to any language.
IMPORTANT ARCHITECTURAL RULES
The frontend and backend must be independent.
Preferred architecture:
Frontend: React + TypeScript
Backend: Python FastAPI
Database: PostgreSQL
Redis for cache, queues, presence and background jobs
Background worker for OCR, document import, transcription, AI tasks, exports and backups
S3-compatible object storage / MinIO-compatible storage
Docker and Docker Compose
Environment-based configuration
REST API with clean versioning
WebSocket/SSE where real-time monitoring is required
Do NOT make Supabase or any Lovable-specific backend service a mandatory dependency.
The finished project must be deployable from GitHub to the teacher’s own Linux server without Lovable being required in production.
All persistent application data must belong to the self-hosted backend.
The UI should be extremely simple and low-fatigue:
Arial or equivalent clean sans-serif typography
mostly white/light interface
very limited accent colors
no excessive gradients
no random AI-generated color mixtures
no unnecessary cards or visual clutter
clear tables, filters and forms
usable by a teacher who is not highly technical
fully responsive
student side must work especially well on mobile
teacher/admin side must also be usable on mobile
All branding must be editable in Admin Settings. Never hard-code the platform name or “English Learning System”.
CORE DOMAIN MODEL
Keep these concepts separate:
Source File
Question
Vocabulary Entry
Reading
Listening
Media
Topic
Catalog
Exam
Exam Assignment
Attempt
Answer
Activity Event
Analytics
Notification
A source document is NOT a question.
A catalog is NOT an exam.
An exam attempt must never depend on the current editable version of a question.
Published exams must use immutable snapshots/versioning so editing a question later NEVER changes historical results.
AUTHENTICATION
There are only two roles initially:
Teacher/Admin
Student
Teacher login:
username
password
both changeable in Admin Settings
secure password hashing
normal server session
no mandatory 2FA
Teacher password recovery must use 5 randomly generated one-time recovery codes.
Requirements:
codes displayed/downloadable when generated
server stores only hashes
each recovery code works once
used code becomes invalid
generating a new recovery-code set invalidates the previous set
Student login uses one Access Key field only.
When a student is created, required fields are:
name
surname
username
Username should be suggested automatically but editable by teacher.
Group/class is optional.
Generate a high-entropy access key similar to:
username@LONG_RANDOM_SECRET
Do not store raw student keys in the database after initial display. Store secure hashes.
Student cannot change the access key.
Teacher can:
revoke old key
generate a new key
disable student
archive student
terminate active sessions
Students may use the same account from multiple devices.
Student states:
Active
Disabled
Archived
Never permanently delete a student by default.
Students may belong to multiple groups.
CONTENT LANGUAGES
Interface languages:
Azerbaijani
English
Russian
Turkish
Each student chooses their own interface language.
Admin does not force the student's interface language.
The platform must support multiple learning languages simultaneously.
Every content object should support a learning_language field where relevant.
Vocabulary translations must be able to retain values for multiple languages.
Example:
word: apple
learning language: English
translations:
AZ: alma
RU: яблоко
TR: elma
If only one translation language is configured, do not force unnecessary multilingual UI.
ADMIN BRANDING AND SYSTEM SETTINGS
Teacher must be able to manage:
system name
short system name
logo
favicon
login screen image/background
login title
welcome message
login instructions
footer
support/contact text
button labels where appropriate
enabled interface languages
learning languages
translation languages
default interface settings
primary accent color
dashboard widgets
content defaults
exam defaults
practice defaults
AI providers
OCR settings
media settings
retention
backups
Do not allow branding customization to destroy UI consistency.
QUESTION ENGINE
Do NOT design questions around only A/B/C/D.
Create a flexible question engine using typed structured data and extensible configuration.
Support from the first production version:
single choice
multiple choice
true / false
True / False / Not Given
Yes / No / Not Given
open text
long text
short answer
fill in the blank
multiple blanks / cloze
sentence completion
summary completion
note completion
table completion
flow-chart completion
matching pairs
matching information
matching headings
matching features
matching sentence endings
ordering / sequencing
word-bank selection
drag-to-match
image labelling
diagram labelling
map/plan labelling
error correction
word formation
sentence transformation
dictation
listening transcription
Architect the question engine so additional types can be added without redesigning the database.
Each question may have:
question text/instructions
question type
options/items
accepted answers
multiple correct answers
image/media
explanation, optional
score
partial scoring configuration
negative scoring configuration
level
topic(s)
tags
learning language
source
source page/sheet
teacher notes
difficulty
status
version
created/updated date
Difficulty is optional.
Explanation is optional.
CEFR/topic data is optional and teacher-controlled.
Questions may belong to zero, one or multiple topics.
Allow custom topic names.
Hierarchical topics should also be supported, for example:
Grammar
→ Tenses
→ Past
→ Past Simple
ANSWER NORMALIZATION
For typed answers support teacher-configurable:
case sensitivity
whitespace normalization
punctuation normalization
multiple accepted answers
alternative spelling
diacritic handling
Example:
color
colour
may both be accepted.
Typo tolerance must NOT silently turn incorrect exam answers into correct answers by default.
Possible typo detection may be shown as assistance in practice or review.
QUESTION VERSIONING
Every meaningful question edit creates a version.
Teacher can inspect previous versions.
Historical attempts retain the exact question snapshot used during that attempt.
Never recalculate old results because a question was edited.
DOCUMENT IMPORT ENGINE
This is one of the most important features.
Support:
PDF
scanned PDF
DOC
DOCX
XLS
XLSX
CSV
common image formats
legacy Office documents where conversion is possible
Allow multiple file upload.
Import pipeline:
Upload
→ file identification
→ native parsing
→ OCR if necessary
→ layout analysis
→ reading-order reconstruction
table/image extraction
section detection
question detection
answer detection
question-type detection
media extraction
vocabulary detection
reading/listening section detection
level/topic suggestions
duplicate detection
validation
teacher review
final import
Never silently trust AI extraction.
There must be an Import Review screen.
Show:
original document/page on one side
extracted structured result on the other side
For scanned questions, show the exact original page/crop when practical.
Teacher can correct extracted data before importing.
AI confidence can be displayed.
Support:
Approve
Reject
Edit
Approve All High Confidence
Auto Accept
Send Low Confidence to Review
Teacher can choose an “automatic mode” where the system accepts AI decisions automatically.
This is teacher-controlled.
If no answer exists in the source document:
default: ask teacher to review
optional: AI proposes the answer
optional teacher setting: AI automatically assigns an answer
PDF/DOCUMENT SOURCES
A single document may contain:
grammar
vocabulary
reading
listening questions
mixed question types
answer key at the end
images
tables
The system must attempt to separate these automatically.
Before import, allow teacher to confirm or change detected sections.
A PDF itself must have a source collection.
Example:
Book 1.pdf
→ 87 extracted questions
Those questions belong to:
the Book 1 source collection
the central global Question Bank
Do NOT create duplicated physical copies just because one question appears in multiple collections.
Keep relationships.
PROVENANCE
Even if the original uploaded document is deleted, preserve metadata such as:
source filename
original page
sheet name
import date
import job
extraction method
Original uploaded source documents should NOT be kept by default after successful extraction.
During upload teacher may select:
Keep original source file
If teacher explicitly deletes a source, allow:
delete only original file
delete source relationship
delete extracted content too
Show clear dependency warnings.
DUPLICATE DETECTION
Exact duplicate:
If question and answers are effectively identical, warn teacher that this already exists.
Possible duplicate:
Use similarity detection and show an inbox alert.
Teacher actions:
Keep both
Skip new
Review differences
Merge when appropriate
Do not automatically merge uncertain questions.
IMPORT PROFILES
Allow teacher to save import presets, such as:
IELTS PDF
Vocabulary spreadsheet
Grammar worksheet
Custom school format
For spreadsheets provide a very easy visual column-mapping interface.
Example:
Column A → Question
Column B → Option A
Column C → Option B
Column D → Option C
Column E → Option D
Column F → Correct Answer
Column G → Topic
Auto-detect first, but allow manual correction.
VOCABULARY BANK
Vocabulary entries may contain:
word
translation(s)
definition
example sentences
IPA
pronunciation/audio
part of speech
synonyms
antonyms
level
topic
learning language
notes
tags
source
Only fields actually available are required.
Teacher can add/edit all fields manually.
Allow import from:
PDF
DOC/DOCX
XLS/XLSX
CSV
manual entry
bulk paste
Optional automatic enrichment should be available.
Teacher decides whether automatic enrichment is used.
Vocabulary can belong to multiple catalogs.
VOCABULARY PRACTICE
Support:
flashcards
word → meaning
meaning → word
multiple choice
typing
spelling
shuffled vocabulary practice
Teacher may optionally enable learner states:
Known
Learning
Difficult
When a student opens a vocabulary catalog and starts practice, words should be shuffled unless catalog settings say otherwise.
READING
Reading is a first-class entity.
Reading consists of:
title
passage/body
optional images
language
level
topic
word count
metadata
one or more question sets
Reading may be created:
manually
from document
Possible combinations:
manual text + manual questions
manual text + imported questions
imported text + manual questions
imported text + imported questions
Reading questions must remain attached to the relevant reading by default.
Do not randomly mix reading-dependent questions into unrelated practice unless teacher explicitly permits it.
Student reading display options:
passage above, questions below
split view
tabbed view
Teacher may choose the preferred layout.
LISTENING
Listening is a first-class entity.
Support audio and video.
Common audio/video formats should be accepted.
A listening may contain:
title
media
sections
transcript
transcript timestamps
metadata
level
topic
one or more question sets
Transcript may be:
absent
entered manually
imported
generated automatically
Teacher chooses.
Questions may be imported separately and attached to a chosen listening.
If a document contains multiple Listening sections, automatically detect them but let teacher confirm mapping.
Listening questions must stay linked to their listening content by default.
Teacher can configure:
listening replay count
pause permission
rewind/seek permission
transcript visibility
playback rules
exam-specific restrictions
Practice mode may allow unlimited listening.
Exam mode can be configured, for example:
maximum 2 plays.
Question-specific audio intervals may be stored using timestamps.
YOUTUBE IMPORT
Teacher may paste a YouTube URL as a media-import source.
The intended workflow is:
YouTube URL
→ import/download permitted media
→ store media in the platform
→ treat it as normal Listening/Video media
Use this only where downloading/importing is permitted and the teacher has the necessary rights.
If import is unavailable, support embedding/reference as a fallback.
The stored local media should no longer depend on YouTube for normal playback.
MEDIA LIBRARY
Create reusable Media Library for:
images
audio
video
A media asset may be reused in multiple pieces of content.
Avoid duplicating the physical file when the same media is reused.
Default maximum imported video file size: 700 MB.
Make file-size limits configurable in server settings.
Show storage usage in Admin Panel.
CATALOGS
Catalog is a reusable learning/practice collection.
It is NOT automatically an exam.
A catalog can contain mixed content:
Example:
Beginner
10 grammar questions
50 vocabulary items
2 listenings with their questions
2 readings with their questions
Catalogs may have any teacher-defined names.
Allow folders/nested organization if useful.
A piece of content may belong to multiple catalogs without being duplicated.
Students can open catalogs and practice them.
Catalog ordering must support:
drag-and-drop
move up/down controls
Question selection for adding content to a catalog must feel like selecting photos on a phone:
clear selectable cards/rows
checkbox selection
multi-select
Select All
bulk actions
search
filters
mobile-friendly selection
This must remain efficient with thousands of questions.
EXAMS
Exam is a separately configured assessment.
Exam sources may include:
manually selected global questions
catalog(s)
one existing catalog converted/used as exam source
uploaded exam document
manually created questions
random pools
Exam states:
Draft
Scheduled
Active
Finished
Archived
Teacher can configure:
availability start
availability end
duration
maximum attempts
passing score
resume after disconnect
random question order
random answer-option order
random selection from pools
section order
navigation rules
previous-question access
copy/paste restriction
tab-switch monitoring
tab-switch limit/action
listening limits
answer visibility
result visibility
explanation visibility
immediate/end feedback
partial scoring
negative scoring
automatic grading
manual grading
automatic submission
When exam timer reaches zero, automatically submit.
AVAILABILITY VS DURATION
Treat these separately.
Example:
Exam available:
18:00–04:00
Student may start during that window.
Attempt duration:
60 minutes
Teacher setting controls whether:
student always receives full 60 minutes after starting
OR
attempt must finish before exam availability closes
OFFLINE/NETWORK SAFETY
During exams:
auto-save answers continuously
cache pending answers locally in browser
sync after connection returns
preserve the last valid answers if connection temporarily fails
Do not allow network failure to erase an exam.
The server remains authoritative about timers and deadlines.
EXAM NAVIGATION
Provide numbered question navigation.
Clearly indicate:
answered
unanswered
flagged/review
current question
Before final submit, if questions are unanswered show:
“You have N unanswered questions. Submit anyway?”
RANDOMIZATION
Separate controls for:
shuffle questions
shuffle answer options
randomly choose N questions from pool
Random exam pools should allow composition rules.
Example:
5 A2 vocabulary
10 B1 grammar
1 reading
1 listening
Maintain pool/topic/level balance when configured.
SCORING
Default score may be 1 point.
Teacher may assign custom points.
Support:
full score
partial score
configurable multiple-choice partial scoring
optional negative marking
Teacher setting controls negative marking.
OPEN/MANUAL ANSWERS
Open answers may be configured as:
automatic
AI-assisted
manual teacher review
For AI-assisted grading return:
Suggested: Correct / Partially Correct / Incorrect
suggested score
confidence
short reason
Teacher can override everything.
Any teacher override is written to audit history.
If question is configured for manual review, send student response to:
Student Questions Box
STUDENT QUESTIONS BOX
Teacher review workspace.
Filters:
student
group
exam
question
question type
date
reviewed
unreviewed
Support bulk operations where safe.
SELF-PRACTICE / TEMPORARY STUDENT EXAMS
Student can create their own temporary practice exam from permitted content.
Filters may include:
language
level
topic
question type
catalog
source
previous mistakes
unused questions
Student may:
create random test
practice mistakes
exclude previously answered questions
choose question count
Do NOT save the generated self-practice exam itself permanently to the server.
Do save normal granular activity:
which question was answered
student's answer
correct/incorrect
time
timestamp
Student may optionally save the temporary practice session locally in the browser and continue it later.
STUDENT DASHBOARD
Include:
questions solved today
correct
incorrect
accuracy
study time
completed exams
grammar progress
vocabulary progress
listening progress
reading progress
weak topics
attempt history
daily progress
weekly progress
monthly progress
streak where enabled
saved/favorite items
Teacher can choose which dashboard widgets students see.
STUDENT RESULTS
Teacher controls result policy.
Possible settings:
show result immediately
show after exam closes
show after teacher approval
hide correct answers
show correct answers
show explanation if one exists
If enabled, provide a clear “Show Answer” button.
PRACTICE FEEDBACK
Teacher setting:
instant feedback after each question
feedback only after session ends
STUDENT FAVORITES
Students can save/favorite:
questions
vocabulary
Provide a simple personal review area.
REPORT QUESTION
Student can report a problematic question.
Teacher receives it in the admin inbox with:
student
question
comment
date
relevant source
GROUPS
Teacher may create groups/classes.
Examples:
IELTS 2026
A2 Morning
B1 Evening
Student may belong to multiple groups.
Teacher may assign exams/catalogs to groups.
MONITORING AND ANALYTICS
This must be a strong feature, but the UI must remain simple.
Teacher can see:
who is currently online
last active time
session duration
current page/section
activity during the day
questions answered
correct answers
incorrect answers
skipped questions
answer changes
time per question
exam activity
practice activity
device/browser information
IP where enabled
tab-switch events
copy/paste violations/events where applicable
Activity should be shown in understandable human language.
Example timeline:
19:02 — Student logged in
19:04 — Opened Vocabulary / A2
19:05 — Answered “apple” correctly
19:08 — Started Reading 4
19:16 — Submitted Reading 4 — 8/10
Do not make the normal teacher read raw JSON or technical logs.
Separate logs into:
Student Activity
Assessment Logs
System / Audit Logs
Advanced technical logs can include:
failed login
imports
OCR jobs
AI jobs
background jobs
backup jobs
system errors
Put technical information in an Advanced area.
QUESTION ANALYTICS
For each question calculate:
attempts
correct percentage
incorrect percentage
average answer time
skip rate
Allow statistics to suggest:
“Possibly too easy”
“Possibly too hard”
Do NOT automatically change difficulty.
CATALOG ANALYTICS
Show:
content counts
students who practiced
number of attempts
average accuracy
weak areas
usage
STUDENT ANALYTICS
Show:
activity timeline
accuracy by topic
learning language
weakest areas
strongest areas
recent mistakes
common error types
time spent
progress trends
Teacher may add private notes about a student.
Students must never see private teacher notes.
Teacher may leave visible feedback on an exam attempt or answer.
DASHBOARD CUSTOMIZATION
Teacher dashboard widgets can be:
shown
hidden
reordered
Teacher can also control which student-dashboard widgets exist.
NOTIFICATIONS / INBOX
Teacher inbox should receive events such as:
duplicate detected
possible duplicate
import finished
import failed
low-confidence extraction
manual grading required
student reported question
exam completed
system warning
storage warning
backup warning
AI/OCR failure
Students should receive:
new exam
upcoming/active exam
result available
teacher feedback
important teacher/system notification
Internal notifications are required.
External notification services are not required initially.
SEARCH
Provide a powerful global search in the admin panel.
Search across:
questions
vocabulary
readings
listenings
catalogs
exams
students
sources
Question filters include:
text
correct answer
question type
level
topic
tag
language
source
catalog
used/unused
date
status
Do not require tags for search.
Tags are optional metadata.
TEACHER CONTENT EDITOR
Provide efficient creation tools:
Save
Save & Add Next
Duplicate
Copy
Bulk edit
Bulk delete/archive
Bulk add to catalog
Bulk tag/topic
Bulk paste questions
spreadsheet import
Teacher should be able to enter many questions quickly using a keyboard.
TRASH / SOFT DELETE
Support Trash/Recycle Bin for:
students
questions
vocabulary
catalogs
exams
readings
listenings
media where possible
Default retention around 30 days, configurable.
Permanent delete must require stronger confirmation.
EXPORTS
Teacher must be able to export more than logs.
Support exporting:
Question Bank
selected questions
Vocabulary Bank
selected vocabulary
catalogs
exams
exam results
student analytics
logs
readings/listenings metadata
Data-oriented formats:
CSV
XLSX
JSON
Human-readable reports:
PDF where appropriate
PORTABLE PACKAGES
Allow teacher to export a catalog/content bundle that can later be imported into another deployment.
Package may contain:
manifest JSON
questions
vocabulary
reading
listening metadata
images
media references/files where selected
settings needed by content
Avoid proprietary lock-in.
BACKUPS
Provide:
manual Create Backup
automated scheduled backups
database backup
file/media backup
restore workflow
Restore must have strong confirmation.
Default analytics/activity retention is permanent.
Admin may configure cleanup/retention.
AI / AUTOMATION ARCHITECTURE
The main platform must work without a paid AI API.
Design AI as providers/adapters.
Primary mode:
Local / self-hosted / free
Optional paid provider:
Gemini, only if teacher provides an API key.
AI is used only where explicitly enabled by the teacher.
Possible AI-supported tasks:
identify question structure
detect question type
detect answer
classify topic
suggest level
parse mixed documents
evaluate uncertain open answers
vocabulary enrichment
duplicate similarity
OCR correction assistance
transcript assistance
Do not force AI for deterministic tasks.
Teacher should select provider from settings.
AI-generated or AI-extracted decisions normally require review unless teacher chooses Auto mode.
FREE / SELF-HOSTED COMPONENT STRATEGY
Build integrations behind replaceable adapters.
Preferred categories:
Document parser:
Docling-compatible adapter
OCR:
PaddleOCR/Tesseract-compatible adapter
Local AI:
Ollama/OpenAI-compatible local endpoint adapter
Speech-to-text:
local Whisper-compatible adapter
Translation:
LibreTranslate/Argos-compatible adapter
Dictionary/vocabulary enrichment:
Wiktionary/Wiktextract/Kaikki-compatible data adapter
Do not tightly couple business logic to one AI model.
Teacher should select provider from settings.
BACKGROUND PROCESSING
Large jobs must not freeze the web interface.
Use background jobs for:
PDF import
OCR
document conversion
AI extraction
transcription
media processing
exports
imports
backups
restore preparation
Show job status:
Queued
Processing
Needs Review
Completed
Failed
Allow retry.
MEDIA AND SOURCE SECURITY
Validate:
MIME type
file extension
file size
Do not trust uploaded filenames.
Use generated storage IDs.
Sanitize document processing.
Never execute uploaded document macros/scripts.
Run document/OCR/media conversion in restricted worker environments.
AUDIT LOG
Important actions must be auditable:
teacher login
key regeneration
student status changes
content edit
content delete
exam publish
score override
manual review
backup
restore
system-setting changes
Keep the normal interface readable.
SECURITY
Use:
Argon2id or equivalent secure password hashing
hashed student access keys
hashed recovery codes
secure HTTP-only cookies where applicable
CSRF protection where applicable
rate limiting
login brute-force protection
server-side authorization checks
input validation
safe file handling
parameterized database access
least privilege
CORS restricted to configured frontend origins
secrets only in environment/config secret storage
Never put secrets into frontend JavaScript.
PERFORMANCE
Target at least:
100–1000+ students
growing Question Bank
thousands/tens of thousands of questions
large activity history
extensive search and filters
Use:
pagination
proper PostgreSQL indexes
async/background processing
server-side filtering
database-level search strategy
caching only where useful
Do not load the entire Question Bank into the browser.
CORE DATABASE ENTITIES
The schema should include or cleanly model equivalents of:
AdminUser
AdminRecoveryCode
Student
StudentAccessKey
StudentSession
Group
GroupMembership
SystemSetting
Language
Topic
Tag
SourceFile
ImportJob
ImportItem
MediaAsset
Question
QuestionVersion
QuestionTopic
QuestionTag
VocabularyEntry
VocabularyTranslation
VocabularyExample
Reading
ReadingQuestionSet
Listening
ListeningQuestionSet
Catalog
CatalogItem
Exam
ExamSection
ExamItem
ExamAssignment
ExamAttempt
AttemptAnswer
ManualReview
TeacherFeedback
StudentNote
ActivityEvent
QuestionReport
Favorite
Notification
ExportJob
Backup
AuditLog
Use normalized relational data where appropriate and JSON/JSONB only for question-type-specific structured payloads.
CRITICAL CONTENT RELATIONSHIP RULE
Listening-dependent questions must not accidentally become detached random questions.
Reading-dependent questions must not accidentally become detached random questions.
Represent parent/context dependency explicitly.
A teacher may explicitly mark a question as reusable independently.
DEFAULT CONTENT BEHAVIOR
Catalog practice:
shuffle content where appropriate
retain reading/listening context
allow normal practice without formal exam restrictions
Exam:
enforce configured rules
preserve immutable snapshots
generate official attempt/result record
Student temporary self-practice:
do not store generated exam definition permanently
store granular learning activity
optionally store temporary state locally in browser
ADMIN UX PRINCIPLE
The backend may be complex.
The admin UI must not feel complex.
Always prefer:
plain language
visible state
sensible defaults
progressive disclosure
simple buttons
confirmation dialogs
preview before destructive actions
undo/trash where possible
Avoid exposing developer terminology to the teacher.
For example, show:
“Processing document”
instead of:
“Worker job #81 running OCR pipeline”.
DELIVERY REQUIREMENTS
Do not produce a fake frontend-only prototype with hardcoded mock data.
Create the project with real data architecture and real API contracts.
If implementation must be split into phases, preserve the complete architecture from this specification and implement incrementally without simplifying the schema.
Suggested implementation order:
application shell, branding and localization
authentication and users/groups
Question Bank + full question engine
vocabulary
reading/listening/media
catalogs
exams and attempts
document import/review pipeline
monitoring/activity logging
analytics
exports/backups
local AI/OCR/transcription integrations
final security/performance hardening
Create migrations and seed only minimal development data.
Provide a clear README containing:
architecture
local development
environment variables
Docker startup
database migrations
worker startup
production deployment
backup/restore
optional AI integrations
The system must remain fully usable without Gemini.
The final product should feel like a simple teacher tool on the surface, while internally being a robust content, examination and analytics platform.

Onda qur: platformanı Lovable-ın dəstəklədiyi texnologiyalarla qururam və ilkin spesifikasiyadakı istehsalda Lovable-dan asılı olmadan öz serverində işləmə tələbindən imtina edirəm.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://fluentforge-suite.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fab1e501-3dbb-4748-b795-4295b2e1d564).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
