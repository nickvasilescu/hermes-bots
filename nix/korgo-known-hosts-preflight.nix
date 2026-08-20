{
  lib,
  pkgs,
}:
{
  knownHostsFile,
  knownHostsSha256,
  lookup,
  hostKeyFingerprint,
}:

pkgs.writeShellScript "korgo-known-hosts-preflight" ''
  set -euo pipefail

  fail() {
    echo "korgo-ssh-client preflight: $*" >&2
    exit 1
  }

  known_hosts=${lib.escapeShellArg knownHostsFile}
  lookup=${lib.escapeShellArg lookup}
  expected_hash=${lib.escapeShellArg knownHostsSha256}
  expected_fingerprint=${lib.escapeShellArg hostKeyFingerprint}

  actual_hash="$(${pkgs.coreutils}/bin/sha256sum "$known_hosts" | ${pkgs.coreutils}/bin/cut -d' ' -f1)"
  [ "$actual_hash" = "$expected_hash" ] ||
    fail "known_hosts content does not match the reviewed manifest hash"

  key_entry_count="$(${pkgs.gawk}/bin/awk '
    NF > 0 && $1 !~ /^#/ { count += 1 }
    END { print count + 0 }
  ' "$known_hosts")"
  [ "$key_entry_count" = 1 ] ||
    fail "the dedicated known_hosts file must contain exactly one non-comment key entry (found $key_entry_count)"

  matched_keys="$(${pkgs.coreutils}/bin/mktemp)"
  trap '${pkgs.coreutils}/bin/rm -f -- "$matched_keys"' EXIT

  if ! ${pkgs.openssh}/bin/ssh-keygen -F "$lookup" -f "$known_hosts" \
    | ${pkgs.gawk}/bin/awk 'NF > 0 && $1 !~ /^#/ { print }' >"$matched_keys"; then
    fail "known_hosts lookup failed for the configured Mini address and port"
  fi

  matched_count="$(${pkgs.coreutils}/bin/wc -l <"$matched_keys" | ${pkgs.coreutils}/bin/tr -d '[:space:]')"
  [ "$matched_count" = 1 ] ||
    fail "known_hosts must contain exactly one key for the configured Mini address and port (found $matched_count)"

  ${pkgs.gawk}/bin/awk -v lookup="$lookup" '
    NR == 1 && $1 == lookup { exact = 1 }
    END { exit exact ? 0 : 1 }
  ' "$matched_keys" ||
    fail "the Mini entry must use the exact literal numeric host/port without markers, aliases, wildcards, or hashed hostnames"

  actual_fingerprint="$(${pkgs.openssh}/bin/ssh-keygen -lf "$matched_keys" -E sha256 \
    | ${pkgs.gawk}/bin/awk 'NR == 1 { print $2 }')"
  [ "$actual_fingerprint" = "$expected_fingerprint" ] ||
    fail "the configured Mini entry does not match the out-of-band verified fingerprint"
''
