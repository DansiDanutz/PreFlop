# Staging bootstrap: first demo data

Run these once, after the first successful deploy (docs/18-staging.md). They use the console admin the simulator seeded from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

```sh
API=https://preflop-staging-api.fly.dev
TOKEN=$(curl -s $API/v1/auth/login -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r .token)

# A free-chip tournament that starts in 10 minutes and runs for an hour.
START=$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)
curl -s $API/v1/admin/tournaments -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{
  \"name\":\"Staging Sprint\",\"mode\":\"play\",\"currency\":\"PLAY\",\"buy_in_minor\":1000,\"fee_bps\":0,
  \"added_minor\":5000,\"starting_stack\":10000,\"bets_allowed\":10,\"min_stake\":100,
  \"starts_at\":\"$START\",\"duration_minutes\":60,\"late_reg_minutes\":30,\"payout_bps\":[5000,3000,2000]}"

# A weekly free-chip leaderboard sponsored with 50,000 free chips.
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ); END=$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)
curl -s $API/v1/admin/leaderboards -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{
  \"name\":\"Staging weekly\",\"mode\":\"play\",\"currency\":\"PLAY\",\"metric\":\"net\",\"min_rounds\":5,
  \"prize_split_bps\":[6000,3000,1000],\"starts_at\":\"$NOW\",\"ends_at\":\"$END\",\"fund_minor\":50000}"
```

Real money stays off: leave `modes_enabled` as it is.
