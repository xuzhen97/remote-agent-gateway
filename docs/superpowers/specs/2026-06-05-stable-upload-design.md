# Stable Upload Design

Date: 2026-06-05
Status: Approved for planning
Scope: Client file upload reliability and progress visibility

## 1. Background

Current client upload uses a single HTTP request to `POST /files/upload`.

Observed issues:

- Uploads through the skill/CLI over FRP are slow and unstable.
- Large uploads can hit wrapper timeouts before the request finishes.
- Users cannot see meaningful upload progress.
- Current implementation reads the full file into memory on the CLI side and the full request body into memory on the client side.

Evidence from the reported behavior:

- One 10 MB chunk completed in about 42.9 seconds.
- Another upload attempt hit an outer 60 second timeout.
- This points to weak-link / unstable-tunnel behavior and a fragile single-request upload model, not to a confirmed memory overflow root cause.

## 2. Goals

1. Keep the external caller experience simple.
2. Make uploads reliable over unstable FRP / HTTP links.
3. Show continuous upload progress during skill/CLI execution.
4. Avoid loading the full file into memory on either side.
5. Support resume after interruption or timeout.

## 3. Non-Goals

This design does not include:

- Compression during transfer
- Server-side data-plane relay for file upload
- Initial parallel chunk upload
- Heavy full-file checksum validation in the first version
- Download redesign in this scope

## 4. User Experience

The external command stays the same:

```bash
files upload --client <id> --root <rootId> --path <path> --file <localFile>
```

The internal protocol changes, but the caller should not need new required flags.

Expected CLI/skill output during upload:

```text
Uploading ruoyi-admin.jar
42.3 MB / 512.0 MB (8.3%) | 236 KB/s | ETA 33m12s | chunk 5/64
```

On transient failure:

```text
chunk 6/64 failed: ECONNRESET
retrying (1/5) after 2s...
```

## 5. Current Constraints and Problems

### 5.1 CLI-side problem

Current `files upload` loads the entire local file with `readFile()` before sending it.

Impact:

- Unnecessary memory pressure for large files
- No fine-grained retry
- No natural progress checkpoints

### 5.2 Client-side problem

Current `/files/upload` reads the entire request body into memory before writing the file.

Impact:

- Large request memory pressure on the client
- Request must succeed as one unit
- Any interruption forces a full restart

### 5.3 Network behavior problem

Current upload is one long request over an unstable FRP path.

Impact:

- Timeout sensitivity
- Poor resilience to tunnel resets
- Hard to distinguish progress from hang

## 6. Proposed Architecture

Replace the single-request upload flow with an upload-session protocol.

### 6.1 High-level model

Each upload becomes:

1. Initialize upload session
2. Upload file parts sequentially
3. Query session state when needed
4. Complete and assemble final file
5. Abort and clean up if needed

### 6.2 New client HTTP endpoints

#### `POST /files/uploads/init`

Purpose:

- Create or resume an upload session for one target file.

Input:

- `rootId`
- `path`
- `filename`
- `size`
- optional `chunkSize`
- optional `lastModified`
- optional `fileFingerprint`

Output:

- `uploadId`
- negotiated `chunkSize`
- `partCount`
- existing uploaded parts if resumable

#### `GET /files/uploads/:uploadId/status`

Purpose:

- Return session progress and uploaded part state.

Output:

- session metadata
- uploaded parts list or compact bitmap form
- uploaded bytes
- timestamps
- target info

#### `PUT /files/uploads/:uploadId/parts/:partNumber`

Purpose:

- Upload one binary chunk.

Input:

- request body = raw chunk bytes
- headers or query fields for offset / size / optional checksum

Output:

- acknowledged part info
- updated uploaded bytes

#### `POST /files/uploads/:uploadId/complete`

Purpose:

- Verify all parts exist, assemble the final file, and atomically publish it.

Output:

- final file info
- final size
- target path

#### `DELETE /files/uploads/:uploadId`

Purpose:

- Abort upload and remove session artifacts.

## 7. Data Layout on Client

Use a dedicated session area, separate from the final target path.

Suggested structure:

```text
<workspaceDir>/.rag-upload-sessions/
  <uploadId>/
    meta.json
    state.json
    part-000000
    part-000001
    ...
    assembling.tmp
```

### Files

- `meta.json`: static session metadata
- `state.json`: uploaded parts and progress state
- `part-*`: one file per uploaded chunk
- `assembling.tmp`: temporary file used during final assembly

Benefits:

- Resume support
- Safe recovery after interruption
- Easier cleanup and debugging
- No partial overwrite of final target file

## 8. Upload Flow

### 8.1 CLI flow

1. Inspect local file metadata.
2. Create lightweight file fingerprint.
3. Call `init`.
4. If resumable session exists, load uploaded-part state.
5. Open local file as a stream.
6. Read each chunk by offset.
7. Upload each missing chunk in order.
8. Update progress after each success.
9. Call `complete`.
10. Print final success result.

### 8.2 Client flow

1. Validate token, root, path, and filename.
2. Create or resume session metadata.
3. For each chunk request, write the part directly to a temp file.
4. Persist uploaded-part state.
5. On `complete`, verify all parts exist.
6. Assemble parts into `assembling.tmp`.
7. Atomically rename to the final target file.
8. Delete the session directory.

## 9. Chunk Strategy

### 9.1 Default chunk size

Initial recommendation:

- default chunk size: 8 MB
- configurable for future tuning

Reasoning:

- smaller than current 10 MB observed test chunk
- large enough to avoid too many requests
- small enough to reduce retransmission cost on failure

### 9.2 Transfer order

Initial recommendation:

- sequential chunk upload only

Reasoning:

- stability matters more than peak throughput
- easier progress semantics
- lower pressure on FRP and client runtime
- simpler failure and retry behavior

Parallel upload can be revisited later if real-world evidence shows stable headroom.

## 10. Retry and Timeout Policy

### 10.1 Per-chunk timeout

Use per-chunk timeout instead of one short timeout for the whole file.

Guideline:

- timeout should scale from chunk size and a conservative minimum throughput assumption
- enforce a sensible floor such as 120 seconds per chunk

This is needed because 10 MB can already take around 43 seconds in the reported environment.

### 10.2 Retry policy

Apply retries at the chunk level.

Initial policy:

- max retries per chunk: 3 to 5
- backoff: 2s, 5s, 10s, then capped

Retryable examples:

- `ECONNRESET`
- `ETIMEDOUT`
- `fetch failed`
- `socket hang up`
- HTTP `502/503/504`

### 10.3 Resume behavior

If the overall command is interrupted, timed out externally, or loses connection:

- keep the upload session on the client
- next identical `files upload` call should automatically resume when fingerprint and target match

## 11. Progress Reporting

Progress must be visible throughout execution.

Displayed values should include:

- filename
- uploaded bytes / total bytes
- percent complete
- current throughput
- elapsed time
- ETA
- current chunk index / total chunks
- retry state when applicable

Progress must update after every successful chunk and during longer transfers when possible.

## 12. Validation and Integrity

First version should prioritize practical integrity checks without excessive overhead.

### 12.1 Required checks

- chunk size matches expected size
- part index is in range
- final part count is complete before assembly
- final assembled file size equals declared upload size

### 12.2 Recommended first-version checksum scope

- optional chunk-level checksum support
- no mandatory full-file checksum in first version

This keeps overhead modest while still improving corruption detection.

## 13. Error Handling Model

### 13.1 Retryable failures

Examples:

- transient network disconnects
- FRP tunnel resets
- upstream gateway instability
- chunk request timeout

Behavior:

- retry current chunk only
- preserve successful earlier chunks

### 13.2 Non-retryable failures

Examples:

- auth failure
- invalid root/path/filename
- disk permission failure
- insufficient disk space
- invalid session state

Behavior:

- fail fast with clear message
- do not keep blindly retrying

### 13.3 Recoverable interruption

Examples:

- wrapper timeout
- user cancellation
- process crash

Behavior:

- keep resumable session artifacts
- allow next command to resume automatically

## 14. Resource and Safety Considerations

### 14.1 Memory

The new design must avoid full-file buffering:

- CLI reads file by chunk
- client writes chunk directly to disk

This reduces memory spikes and makes memory growth independent of full file size.

### 14.2 Atomic finalization

The final target file must not be replaced until all chunks are uploaded and assembly succeeds.

This avoids corrupt partial target files.

### 14.3 Path safety

Existing root/path validation rules remain in force. The upload session directory must stay under an internal safe path controlled by the client runtime.

## 15. Cleanup Policy

### 15.1 Immediate cleanup

- successful completion: delete session directory
- explicit abort: delete session directory

### 15.2 Delayed cleanup

Keep interrupted sessions for resume, then remove stale sessions after an inactivity threshold.

Suggested initial policy:

- expire sessions after 24 to 72 hours without activity

## 16. Compatibility Plan

External compatibility goal:

- keep `files upload` as the primary user-facing command

Internal compatibility options:

- preserve old `/files/upload` temporarily for small/simple use cases if needed
- move CLI uploads fully to the new session protocol

Preferred direction:

- CLI uses the new protocol by default for all uploads to keep behavior consistent

## 17. Testing and Verification Plan

Implementation is not complete until the following are verified:

1. Small file upload succeeds.
2. Large file upload succeeds over the current FRP-based path.
3. Progress is continuously visible during upload.
4. Chunk retry triggers on transient failure.
5. Interrupted upload resumes instead of restarting from zero.
6. Final file size matches the local source file.
7. Client memory no longer scales with full file size in the old way.
8. Stale session cleanup works.
9. Error messages clearly distinguish retryable and non-retryable failure cases.

## 18. Recommendation

Proceed with a chunked upload-session implementation that keeps the existing `files upload` command unchanged for callers.

This is the best fit because it simultaneously provides:

- simple caller UX
- resilience on unstable networks
- visible progress
- lower memory risk
- a foundation reusable later by the web UI
