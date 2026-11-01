---
title: Member storage and media verification — 2026-11-01
description: Runtime evidence for malformed member storage and a hash-bound review of 64 historical media assets, including complete recording frames and explicit provenance limits.
---

# Member storage and media verification — 2026-11-01

This follow-up completes the verification work in [#1711](https://github.com/Kevinjohn/capacitylens/issues/1711),
following [#1700](https://github.com/Kevinjohn/capacitylens/issues/1700) and
[PR #1702](https://github.com/Kevinjohn/capacitylens/pull/1702). The application and original media inputs
are pinned to `c7e3aaa5c88cd7fea7bca10d8ae1148a7cbe74de`; this follow-up adds tests, evidence and
walkthrough context. It changes no production directory, authentication or database behavior.
Final test commands, results and the delivery revision are recorded in the PR.

## Malformed member storage

The real SQLite regression suite covers invalid membership role, invalid membership status and
invalid restriction-only role. A valid Owner reads another principal, so a failed authorization
cannot substitute for the intended guard. Each case checks its exact service error and an actual
authenticated directory GET: generic `500 { error: 'Internal server error.' }`, without a partial
successful directory, raw corrupt value or stack under the existing debug-off policy. Healthy and
restored reads return 200. Three separate guard-bypass probes fail at their matching assertions.

The restriction table has a role CHECK. Its fixture inserts a valid row, proves invalid SQL writes
are refused, closes the sole idle physical SQLite handle, and replaces one uniquely identified
same-length row value in the disposable test file. The retained logical pool opens a fresh handle.
The table schema remains identical, CHECK enforcement remains enabled, and invalid updates are
still refused afterward. No constraint or foreign key is disabled and no second writer is added.
This is a test-only corruption fixture, not a repair capability.

Snapshots cover membership, restrictions, settings, planning revision, audit and command receipts:
directory reads neither repair the malformed row nor write those product states. Normal session
bookkeeping is outside that assertion. Foreign-company malformed membership role/status and
restriction-only role do not poison the authorized directory. A membership-backed principal's
overlapping restriction is skipped when projecting restriction-only entries, preserving the
existing membership role and disabled-access flag. Existing compile-time negative cases remain.

[Focused runtime results and three guard-bypass failures](/reviews/1711/runtime.json) pin the test
source and unchanged production service hashes.

## Media evidence

- [64-path asset, metadata and retention manifest](/reviews/1711/assets.json)
- [GIF frame coverage and exact reconstruction record](/reviews/1711/gif_frames.json)
- [MP4 native-frame coverage](/reviews/1711/mp4_frames.json)
- [Current-demo replay and screenshot hashes](/reviews/1711/replay.json)

The reconstruction uses pinned tree `13866f5b6153bafdc524f1d20f3ab87ce53434fb`: 172 media paths
under `docs-src/screenshots/`, minus 108 distinct Markdown-image consumers, leaves 64 candidates.
All 64 original file hashes and Git blobs still match. Searches of original review history,
previous local investigation artifacts and reachable Git paths did not recover the original
per-path ledger. **The reconstructed set is not certified identical to that missing list.**

All 62 stills were opened at original resolution. Both recordings were fully decoded and accounted
for; no temporal sampling or perceptual deduplication substitutes for frame coverage:

| Asset | Complete coverage | Playback |
| --- | --- | --- |
| GIF, 1280×720 | 774 frames / 51.6 seconds; 539 exact unique RGBA images and 235 repeats. The full base frame and every zero-threshold changed-pixel crop were inspected at 1:1 scale across 56 sheets. Applying those crops reconstructs all 774 decoded frames with zero pixel mismatches. The ledger records every duration, hash, representative and bbox. | A 53-second playback pass with beginning/middle/end checkpoints supplements the complete frame review. |
| MP4, 1920×1080 | All 1,548 decoded frames / 51.6 seconds were individually inspected at native resolution, including 86 exact-repeat instances; 1,462 unique RGB hashes. Every index is present once in the consolidated ledger. | Browser playback reached `ended`, time/duration 51.6 seconds, no media error; elapsed 51.769 seconds. |

GIF durations alternate at the format's centisecond precision: 774 / 51.6 gives a mean 15 displayed
frames per second. A decoder's nominal `r_frame_rate` is not used as the mean rate.

### Metadata

ExifTool 13.60 was read from the [official source repository](https://github.com/exiftool/exiftool)
at `980409314fddbd83d9092b5c160fafab7f67fd52` (archive SHA-256
`9993f5261e61ac5bcb064f3054578c71b67b2e704227afe820edfd58d5e2c2db`). All 64 originals were read
with duplicate, unknown and unknown-binary tags, group families 0–6, structured values and embedded
extraction enabled; the recorded pass has zero warnings. Pillow and format parsers plus ffprobe
cross-check EXIF/XMP/IPTC, PNG/JPEG text and application sections, GIF extensions, ICC fields,
recognized thumbnails/previews, and recording streams/tags/chapters/attachments.

No personal/contact/location/device-serial/credential/bearer values were observed in the inspected
embedded fields. The two Photoshop digests describe empty IPTC datasets. The MP4's unknown edit-list
box decodes to a standard 51.6-second timing entry, not free-form user metadata. There is one video
stream, no audio or attachment stream, and no chapters. Filesystem/Spotlight values are excluded.
The asset manifest lists exposed fields and format-specific results, rather than inferring absence
of metadata from an empty response. Arbitrary steganography and information outside the tools'
recognized/unknown-section surface are not certified absent.

### Findings and decisions

| Observation | Final disposition |
| --- | --- |
| Six historical captures contain `capacitylens.dev` addresses. | Retain. The identities are fictional DC characters, supported by first-party seed/member/mail fixtures. This is the synthetic project domain, not a reserved example domain; no real customer identity or secret was established. |
| Four files with `.png` names have JPEG signatures. | Retain historical names and their references/pins. Metadata inspection used the detected format; no rendering failure was established. The manifest records each mismatch. |
| Drag preview passes through Barry's row before release onto Clark. | Transient preview, not an incorrect committed destination. Adjacent frames show the final reassignment and toast. |
| An add-person cue starts on Projects and persists into the resource form. | Retain as the following-action cue. The complete sequence navigates to Resources, fills the form and saves Selina. |
| Intermediate allocation forms have an enabled-looking Save with Activity unselected. | Appearance alone establishes no validation defect; no invalid save is attempted. Subsequent frames select an activity and save successfully. |
| Resource form footer is initially outside the viewport. | Later frames scroll and save; complete-sequence inspection includes those controls. |
| Dates, example allocations and resulting capacity differ in the current demo. | Add explicit dated/illustrative context beside both active embeds and make their alternative text describe reassignment without promising spare capacity. Preserve the unchanged recordings. |

At the inspected application revision, excluding these new verification artifacts, there are
two active recording assets, 20 matching publication integrity pins, two known screenshot-output
filenames, and 40 remaining stills without those pre-existing tracked references. The smoke script
writes its two optional outputs; it does not read the committed images as test inputs. The MP4
has README and source/generated documentation consumers. Its generated asset remains byte-identical.
All 64 original assets are retained with per-path rationale. Historical stills are evidence, not
certified current instructions; no deletion or blanket recapture is justified.

## Complete current-demo replay

The full recorded workflow was exercised through UI controls at 1920×1080: choose Wayne Enterprises,
inspect/hover capacity, reassign the tentative booking, draw and save Bruce's Workshop booking,
change the visible weeks, add Daily Planet, add Website Relaunch under that client, add Selina Kyle
as an Illustrator in Design, draw and save her Design allocation, and open the four-week Overview
Ledger. The allocation count progresses 6 → 7 → 8. Both new bookings use upcoming dates: Bruce
on 2–3 November and Selina on 9–13 November. Row-level assertions confirm Bruce has zero free
days of two available for 2–8 November, and Selina has zero free days of five available for
9–15 November. The new entities, bookings and their effect on upcoming availability are visible.
Eight-week navigation is also available. The Tentative control was toggled off and on.

Calendar/example-load differences are explicit in the replay record. In the current example,
reassignment reduces Bruce's load while Clark retains over-capacity days; moving work alone is not
claimed to resolve every conflict. The historical clip demonstrates the interaction, not a fixture
of today's capacity values. No missing control or broken recorded workflow was found.

These original-resolution captures contain fictional demo data and were reviewed before publication:

- [Initial capacity indicators](/reviews/1711/replay/replay_schedule_initial.png)
- [Booking reassigned to Clark](/reviews/1711/replay/replay_reassigned.png)
- [Daily Planet client](/reviews/1711/replay/replay_clients_created.png)
- [Website Relaunch project](/reviews/1711/replay/replay_projects_created.png)
- [Selina Kyle resource](/reviews/1711/replay/replay_resource_created.png)
- [Completed bookings](/reviews/1711/replay/replay_schedule_completed.png)
- [Final Overview](/reviews/1711/replay/replay_overview_final.png)

The screenshots support visible outcomes; the action assertions and replay record establish the
exercised journey. Demo changes are in memory, so this is not a persistence claim. This review is
bounded to the enumerated assets, decoded frames, exposed metadata and recorded interactions; it
is not an unconditional privacy or whole-product security certification.
