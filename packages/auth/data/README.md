# Common/breached-password list

`common-passwords.txt.gz` — the offline denylist checked whenever a password is chosen (invitation
acceptance, password change, account recovery; `docs/development/security.md` §1, steps.md 13.3). Passwords are
never sent to an external service.

**Content:** the 60 000 most common passwords with at least 15 characters (the minimum length of
VMN), in comparison form — NFKC, lower case, white space removed — one per line, most common first,
plus a few context entries (the service name, famous passphrases). Hash-like entries (16+ hex
digits mixing letters and digits) are left out: nobody chooses them.

**Sources** (SecLists, MIT License, © Daniel Miessler — https://github.com/danielmiessler/SecLists):

- `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` (UK NCSC, from Have I Been Pwned)
- `Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt`
- `Passwords/Common-Credentials/Pwdb_top-10000000.txt`

The three lists are merged by rank (the most common entries of each first).

**Update** (maintainers; needs network access, run from the repository root):

```sh
node packages/auth/scripts/update-common-passwords.ts
```

Review the diff size, run `pnpm test`, and record the update in `docs/development/steps.md`. Keep the size
reasonable: the list is loaded into server memory (≈5 MB for 60 000 entries).
