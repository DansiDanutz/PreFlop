import { test } from "node:test";
import assert from "node:assert/strict";
import { api, catalogue } from "../server.mjs";
import { localDatabase } from "../scripts/sqlite.mjs";
import { flopFromCards } from "../../packages/odds-engine/src/flops.ts";
import { parseCard } from "../../packages/odds-engine/src/cards.ts";
import { getSelection } from "../../packages/odds-engine/src/markets.ts";

const origin = "https://preflop.test";
async function setup(t) {
  const DB = localDatabase();
  t.after(() => DB.close());
  const client = async (path, body, cookie = "", extra = {}) => {
    const response = await api(
      new Request(origin + "/api/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...(body
            ? {
                "Content-Type": "application/json",
                Origin: origin,
                "X-Preflop-Request": "1",
              }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...extra,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { DB },
    );
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  };
  const boot = await client("bootstrap");
  assert.equal(boot.status, 200);
  return { DB, client, cookie: boot.cookie, boot: boot.data };
}
const prediction = (extra = {}) => ({
  requestId: crypto.randomUUID(),
  tableId: "atlas-04",
  selectionId: "rank-pattern:pair",
  stake: 100,
  oddsCenti: catalogue.find((s) => s.id === "rank-pattern:pair").oddsCenti,
  ...extra,
});

test("bootstrap creates a server profile, secure session, exact catalogue and six unique favorites", async (t) => {
  const { client, cookie, boot } = await setup(t);
  assert.equal(boot.profile.balance, 10000);
  assert.equal(new Set(boot.profile.favorites).size, 6);
  assert.equal(boot.catalogue.length, 241);
  assert.ok(
    boot.profile.favorites.every((id) => catalogue.some((s) => s.id === id)),
  );
  const again = await client("bootstrap", null, cookie);
  assert.equal(again.data.profile.createdAt, boot.profile.createdAt);
  assert.equal(again.cookie, undefined);
  assert.equal(again.headers.get("cache-control"), "no-store");
});
test("all offered selections have a valid exact-engine predicate and integer decimal price", () => {
  for (const s of catalogue) {
    assert.equal(typeof getSelection(s.id).wins, "function");
    assert.ok(Number.isInteger(s.oddsCenti));
    assert.ok(s.oddsCenti >= 100);
  }
});
test("favorites persist and reject duplicate, missing and stale selections", async (t) => {
  const { client, cookie, boot } = await setup(t);
  const ids = [...boot.profile.favorites];
  ids[0] = "red-count:2";
  assert.equal(
    (await client("favorites", { ids, version: 0 }, cookie)).status,
    200,
  );
  assert.deepEqual(
    (await client("bootstrap", null, cookie)).data.profile.favorites,
    ids,
  );
  assert.equal(
    (await client("favorites", { ids, version: 0 }, cookie)).status,
    409,
  );
  assert.equal(
    (
      await client(
        "favorites",
        { ids: Array(6).fill(ids[0]), version: 1 },
        cookie,
      )
    ).status,
    400,
  );
});
test("server chooses and evaluates a flop using the same predicate as the catalogue", async (t) => {
  const { client, cookie } = await setup(t);
  const body = prediction(),
    r = await client("round", body, cookie);
  assert.equal(r.status, 200);
  const round = r.data.round;
  assert.equal(new Set(round.cards).size, 3);
  const won = getSelection(body.selectionId).wins(
    flopFromCards(round.cards.map(parseCard)),
  );
  assert.equal(round.won, won);
  assert.equal(
    round.payout,
    won ? Math.floor((body.stake * body.oddsCenti) / 100) : 0,
  );
  assert.equal(round.balanceAfter, 10000 - body.stake + round.payout);
  assert.equal(r.data.profile.balance, round.balanceAfter);
});
test("50 concurrent retries produce one receipt and exactly one balance change", async (t) => {
  const { client, cookie, DB } = await setup(t);
  const body = prediction();
  const results = await Promise.all(
    Array.from({ length: 50 }, () => client("round", body, cookie)),
  );
  assert.ok(results.every((r) => r.status === 200));
  const history = (await client("history", null, cookie)).data;
  assert.equal(history.history.length, 1);
  assert.equal(history.profile.balance, history.history[0].balanceAfter);
  assert.equal(DB.sql.prepare("SELECT COUNT(*) n FROM rounds").get().n, 1);
  assert.equal(history.profile.version, 1);
});
test("same request ID with changed prediction is rejected without another debit", async (t) => {
  const { client, cookie } = await setup(t);
  const body = prediction();
  await client("round", body, cookie);
  assert.equal(
    (await client("round", { ...body, stake: 200 }, cookie)).status,
    409,
  );
  assert.equal((await client("history", null, cookie)).data.history.length, 1);
});
test("concurrent independent rounds preserve the balance equation", async (t) => {
  const { client, cookie } = await setup(t);
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => client("round", prediction(), cookie)),
  );
  assert.ok(responses.every((r) => [200, 409].includes(r.status)));
  const { history, profile } = (await client("history", null, cookie)).data;
  assert.equal(
    history.length,
    responses.filter((r) => r.status === 200).length,
  );
  assert.equal(profile.balance, 10000 + history.reduce((s, r) => s + r.net, 0));
  assert.ok(profile.balance >= 0);
});
test("unavailable table, forged odds and invalid amounts cannot create rounds", async (t) => {
  const { client, cookie } = await setup(t);
  for (const input of [
    { tableId: "atlas-12" },
    { oddsCenti: 99999 },
    { stake: -100 },
    { stake: 1.5 },
    { stake: 1001 },
    { selectionId: "nope" },
  ])
    assert.ok((await client("round", prediction(input), cookie)).status >= 400);
  assert.equal((await client("history", null, cookie)).data.history.length, 0);
});
test("insufficient balance is rejected and a refill is free and bounded", async (t) => {
  const { client, cookie, DB } = await setup(t);
  DB.sql.prepare("UPDATE profiles SET balance=20").run();
  assert.equal((await client("round", prediction(), cookie)).status, 409);
  assert.equal(
    (await client("refill", {}, cookie)).data.profile.balance,
    10000,
  );
  assert.equal((await client("refill", {}, cookie)).data.profile.version, 1);
});
test("profile sessions cannot see each other’s receipts or saved state", async (t) => {
  const { client, cookie } = await setup(t);
  const other = await client("bootstrap");
  const body = prediction();
  await client("round", body, cookie);
  assert.equal(
    (await client("round/" + body.requestId, null, other.cookie)).status,
    404,
  );
  assert.equal(
    (await client("history", null, other.cookie)).data.history.length,
    0,
  );
  assert.equal((await client("round", body, other.cookie)).status, 200);
});
test("cross-origin writes, missing sessions and malformed payloads are rejected", async (t) => {
  const { client, cookie } = await setup(t);
  assert.equal(
    (
      await client("round", prediction(), cookie, {
        Origin: "https://other.test",
      })
    ).status,
    403,
  );
  assert.equal((await client("round", prediction())).status, 401);
  assert.equal((await client("favorites", {}, cookie)).status, 400);
});
test("database rejects a negative balance and an inconsistent receipt", async (t) => {
  const { DB } = await setup(t);
  assert.throws(() => DB.sql.prepare("UPDATE profiles SET balance=-1").run());
  const p = DB.sql.prepare("SELECT id FROM profiles").get();
  assert.throws(() =>
    DB.sql
      .prepare("INSERT INTO rounds VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        crypto.randomUUID(),
        p.id,
        "atlas-04",
        "rank-pattern:pair",
        100,
        500,
        0,
        0,
        "[]",
        10000,
        10000,
        Date.now(),
      ),
  );
});
