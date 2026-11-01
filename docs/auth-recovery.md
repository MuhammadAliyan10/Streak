# Authentication recovery

This app has one owner account and does not support email delivery or password resets. Keep the owner's email and a secure copy of the owner token outside this repository.

If the password is lost, first confirm the intended Neon project and development branch in the Neon Console and make a backup. In the SQL Editor, delete only that account's sessions and user row inside a transaction; deleting the user also cascades to its sessions. Do not drop schemas or tables. Then use the app's private setup screen with the current owner token to register the owner again. The database's `owner_access` row remains in place, so no token reset is needed.

If the owner token is lost, use the existing offline owner-token recovery procedure: generate a new high-entropy token locally, replace the singleton `private.owner_access.token_hash` with its SHA-256 digest in the verified branch, then enter the new token in the app. This invalidates the old token. Do not paste the token, database URL, or digest into chat or commit them.

This recovery requires direct access to the correct Neon branch. Never perform it against an unidentified or production branch.
