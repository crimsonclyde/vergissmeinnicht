#!/usr/bin/env bash
# Operator-only, read-only diagnostics. Print fixed fields suitable for sharing.
set -euo pipefail

if [[ $# != 3 || ! $1 =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ || ! $2 =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ||
      ! $3 =~ ^https://[a-zA-Z0-9][a-zA-Z0-9.-]*(:[0-9]{1,5})?$ ]]; then
  echo 'Usage: bash deploy/mcp-diagnostics.sh VMN_CONTAINER TUNNEL_CONTAINER https://VMN_HOST' >&2
  exit 2
fi
vmn=$1
tunnel=$2
origin=$3

for tool in docker jq curl nsenter timeout; do
  if ! command -v "$tool" >/dev/null; then
    printf 'Missing required host command: %s\n' "$tool" >&2
    exit 2
  fi
done

echo "VMN Docker connection report · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
inspect() {
  timeout 5 docker inspect --type container --format "$2" "$1" 2>/dev/null
}

for service in vmn tunnel; do
  name=$vmn
  if [[ $service == tunnel ]]; then name=$tunnel; fi
  state=$(inspect "$name" '{{.State.Status}}' || true)
  case "$state" in
    running|created|restarting|removing|paused|exited|dead) ;;
    *) state=unavailable ;;
  esac
  printf '%s container: %s\n' "$service" "$state"
  image=$(inspect "$name" '{{.Config.Image}}' || true)
  case "$service:$image" in
    vmn:ghcr.io/crimsonclyde/vergissmeinnicht:*|tunnel:ghcr.io/openai/tunnel-client:*)
      tag=${image##*:}
      if [[ $tag =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then printf '%s image version: %s\n' "$service" "$tag"; fi
      ;;
  esac
done

pid=$(inspect "$tunnel" '{{.State.Pid}}' || true)
if [[ $pid =~ ^[1-9][0-9]*$ ]]; then
  net_curl() {
    nsenter -t "$pid" -n curl -q --noproxy '*' --silent --max-time 5 "$@" 2>/dev/null
  }
  http_status() {
    local status
    status=$(net_curl -o /dev/null -w '%{http_code}' "$1") || status=unavailable
    if [[ $status =~ ^[1-5][0-9]{2}$ ]]; then printf 'HTTP %s\n' "$status"; else echo 'unavailable'; fi
  }
  printf 'Tunnel loopback readiness (default port): '
  http_status http://127.0.0.1:8080/readyz
  printf 'VMN HTTPS from tunnel network (host resolver), unauthenticated MCP: '
  http_status "$origin/mcp"

  if resource=$(net_curl --fail --max-filesize 65536 "$origin/.well-known/oauth-protected-resource/mcp") &&
     issuer=$(net_curl --fail --max-filesize 65536 "$origin/.well-known/oauth-authorization-server") &&
     jq -es --arg origin "$origin" '
       length == 2 and .[0].resource == ($origin + "/mcp")
       and .[0].authorization_servers[0] == ($origin + "/")
       and .[1].issuer == ($origin + "/")
       and .[1].authorization_endpoint == ($origin + "/authorize")
       and .[1].registration_endpoint == ($origin + "/register")
       and .[1].token_endpoint == ($origin + "/token")
     ' >/dev/null 2>&1 <<< "$resource"$'\n'"$issuer"; then
    echo 'OAuth discovery from tunnel network: exact origin and issuer match'
  else
    echo 'OAuth discovery from tunnel network: unavailable or metadata mismatch'
  fi
else
  echo 'Tunnel readiness and upstream HTTPS: unavailable (no running tunnel namespace)'
fi

echo 'Recent VMN HTTP requests (last 15 minutes, at most 25 matching requests):'
if events=$(timeout 10 docker logs --since 15m --tail 4000 "$vmn" 2>&1 | jq -nRr '
  def allowed:
    ( .method == "POST" and (.url == "/api/account/mcp/approve" or .url == "/token"
      or .url == "/mcp" or .url == "/register") )
    or ( .method == "GET" and (.url == "/mcp" or .url == "/.well-known/oauth-authorization-server"
      or .url == "/.well-known/oauth-protected-resource/mcp") );
  reduce (inputs | fromjson? | objects) as $entry ({pending:{}, output:[]};
    if ($entry.reqId | type) != "string" then .
    else ([$entry.pid, $entry.reqId] | tojson) as $id
      | if $entry.msg == "incoming request" and ($entry.req | type) == "object" then
          ($entry.req | {method, url: (.url | tostring | split("?")[0])}) as $route
          | if ($route | allowed) then .pending[$id] = $route else . end
        elif $entry.msg == "request completed" and .pending[$id] then
          ($entry.res.statusCode) as $status
          | if ($status | type) == "number" and $status >= 100 and $status <= 599 and ($status | floor) == $status
            and ($entry.time | type) == "number" and $entry.time >= 0 and $entry.time < 4102444800000 then
              .output += [ ([($entry.time / 1000 | floor | todateiso8601),
                .pending[$id].method, .pending[$id].url, ($status | tostring)] | join(" ")) ]
            else . end
          | del(.pending[$id])
        else . end
    end)
  | .output[-25:][]
' 2>/dev/null); then
  printf '%s\n' "${events:-No matching structured VMN request logs in the sample.}"
else
  echo 'Structured VMN request logs unavailable.'
fi
echo 'Verify actual dispatch and a grocery List read in the assistant.'
