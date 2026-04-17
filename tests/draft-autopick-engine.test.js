const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDraftAutopickEngine
} = require("../assets/js/draft-autopick-engine.js");

function makePlayers() {
  return [
    { name: "Player A", position: "WR", rank: 5, adp: 8 },
    { name: "Player B", position: "EDGE", rank: 6, adp: 15 },
    { name: "Player C", position: "CB", rank: 20, adp: 28 },
    { name: "Player D", position: "QB", rank: 35, adp: 45 },
    { name: "Player E", position: "OT", rank: 45, adp: 52 },
    { name: "Player F", position: "RB", rank: 65, adp: 80 }
  ];
}

function makeEngine(overrides) {
  return createDraftAutopickEngine(overrides || {});
}

test("availability estimation usa fallback cuando faltan señales externas", function () {
  const engine = makeEngine();
  const availability = engine.estimateAvailability(
    { name: "No Signals", position: "WR", rank: 10 },
    { pick: 15, round: 1 },
    {}
  );

  assert.equal(typeof availability.probability, "number");
  assert.ok(availability.probability >= 0 && availability.probability <= 1);
  assert.ok(Array.isArray(availability.notes));
  assert.ok(availability.notes.includes("rank_fallback"));
});

test("team needs scoring favorece need prioritaria", function () {
  const engine = makeEngine({
    featureFlags: {
      includeRandomness: false
    }
  });

  const states = engine.initializeTeamStates([
    { team: "MIA", needs: ["WR", "CB", "EDGE", "OL", "S"] }
  ]);

  const teamState = states.MIA;

  const wrScore = engine.scorePlayerForTeam(
    { name: "WR Prospect", position: "WR", rank: 12 },
    teamState,
    { pick: 20, round: 1 },
    [{ name: "WR Prospect", position: "WR", rank: 12 }],
    { teamCode: "MIA" }
  );

  const rbScore = engine.scorePlayerForTeam(
    { name: "RB Prospect", position: "RB", rank: 12 },
    teamState,
    { pick: 20, round: 1 },
    [{ name: "RB Prospect", position: "RB", rank: 12 }],
    { teamCode: "MIA" }
  );

  assert.ok(wrScore.teamFitScore > rbScore.teamFitScore);
});

test("shortlist generation limita candidatos por pick y ranking", function () {
  const engine = makeEngine();
  const players = [];

  for (let i = 1; i <= 60; i += 1) {
    players.push({
      name: "P" + i,
      position: i % 2 === 0 ? "WR" : "CB",
      rank: i
    });
  }

  const teamState = engine.createTeamState("LV");
  const pool = engine.getCandidatePool(players, teamState, { pick: 10, round: 1 });

  assert.equal(pool.length, 20);
  assert.equal(pool[0].rank, 1);
  assert.equal(pool[pool.length - 1].rank, 20);
});

test("final pick selection es determinista si randomness está desactivado", function () {
  const engine = makeEngine({
    featureFlags: {
      includeRandomness: false
    }
  });

  const teamState = engine.createTeamState("TEN");
  teamState.needProfile = {
    WR: 120,
    EDGE: 60
  };

  const players = makePlayers();

  const decisionA = engine.decidePick({
    teamCode: "TEN",
    pickInfo: { pick: 15, round: 1 },
    availablePlayers: players,
    teamState: teamState
  });

  const decisionB = engine.decidePick({
    teamCode: "TEN",
    pickInfo: { pick: 15, round: 1 },
    availablePlayers: players,
    teamState: teamState
  });

  assert.equal(decisionA.selectedPlayer.name, decisionB.selectedPlayer.name);
});

test("fallbacks robustos cuando faltan campos no rompen la selección", function () {
  const engine = makeEngine({
    featureFlags: {
      includeRandomness: false
    }
  });

  const teamState = engine.createTeamState("NE");
  teamState.needProfile = { QB: 100 };

  const decision = engine.decidePick({
    teamCode: "NE",
    pickInfo: { pick: 40, round: 2 },
    availablePlayers: [
      { name: "Unknown 1", position: "QB" },
      { name: "Unknown 2", position: "RB" }
    ],
    teamState: teamState
  });

  assert.ok(decision.selectedPlayer);
  assert.ok(decision.explanation);
  assert.equal(typeof decision.explanation.final_score, "number");
});
