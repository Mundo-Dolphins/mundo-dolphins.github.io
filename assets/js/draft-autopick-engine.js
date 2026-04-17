(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.DraftAutopickEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_ENGINE_CONFIG = {
    featureFlags: {
      usePipelineEngine: true,
      includeConsensusSignals: true,
      includeAvailabilityModel: true,
      includeRandomness: true,
      debug: false
    },
    pool: {
      earlyMaxPick: 32,
      midMaxPick: 100,
      earlySize: 20,
      midSize: 30,
      lateSize: 40,
      shortlistSize: 12,
      finalistsCount: 5,
      finalistWeights: [40, 25, 18, 10, 7]
    },
    scoring: {
      finalAlphaTeamFit: 0.7,
      finalBetaAvailability: 0.3,
      finalConsensusWeight: 0.15,
      boardBase: 1500,
      boardRankFallback: 400,
      randomnessMin: 0,
      randomnessMax: 20,
      reachOffset: 8,
      reachPenaltyMultiplier: 3,
      duplicatePositionPenalties: [0, 12, 28, 50],
      positionValueMap: {
        QB: 35,
        OT: 28,
        EDGE: 26,
        CB: 24,
        WR: 22,
        DL: 18,
        LB: 10,
        S: 8,
        IOL: 6,
        TE: 4,
        RB: -5
      },
      premiumPositionBoost: {
        QB: 18,
        OT: 14,
        EDGE: 14,
        CB: 12,
        WR: 10
      },
      rosterFloorBoost: {
        QB: 18,
        OT: 16,
        IOL: 12,
        CB: 14,
        S: 10,
        EDGE: 12,
        DL: 10,
        LB: 8,
        WR: 10,
        TE: 7,
        RB: 6
      },
      minDepthByPosition: {
        QB: 1,
        RB: 1,
        WR: 2,
        TE: 1,
        OT: 2,
        IOL: 2,
        EDGE: 2,
        DL: 2,
        LB: 2,
        CB: 2,
        S: 2
      },
      maxPositionCounts: {
        QB: 2,
        RB: 2,
        WR: 3,
        TE: 2,
        OT: 3,
        IOL: 3,
        EDGE: 3,
        DL: 3,
        LB: 3,
        CB: 3,
        S: 3
      },
      needDecayFactor: 0.25,
      needWeightsImmediate: [100, 70, 45],
      needWeightsFuture: [30, 20, 12, 8, 5],
      scarcityRankWindow: 30,
      scarcityBonusHigh: 15,
      scarcityBonusLow: 8,
      scarcityThresholdHigh: 2,
      scarcityThresholdLow: 5
    },
    availability: {
      logisticK: 0.08,
      scoreScale: 100,
      expectedPickWeights: {
        rank: 0.5,
        adp: 0.25,
        consensusRank: 0.15,
        mockRangeMid: 0.1
      }
    },
    consensus: {
      boardAlignmentScale: 40,
      rangeAlignmentBonus: 10,
      rangeMissPenalty: 8,
      projectedRoundBonus: 10,
      projectedRoundMissPenalty: 6,
      teamMockAffinityScale: 20
    }
  };

  function createDraftAutopickEngine(userConfig) {
    const config = mergeDeep(DEFAULT_ENGINE_CONFIG, userConfig || {});

    function initializeTeamStates(teamNeeds) {
      const states = {};

      if (!Array.isArray(teamNeeds)) {
        return states;
      }

      teamNeeds.forEach(function (entry) {
        const teamCode = normalizeTeamCode(entry && entry.team);
        if (!teamCode) {
          return;
        }

        states[teamCode] = {
          team: teamCode,
          needProfile: buildInitialNeedProfile(entry.needs || [], config),
          draftedCountByPosition: {}
        };
      });

      return states;
    }

    function rebuildTeamStatesFromPicks(teamStates, picks) {
      if (!teamStates || !Array.isArray(picks)) {
        return;
      }

      picks.forEach(function (pick) {
        const teamCode = normalizeTeamCode(pick && pick.team);
        const teamState = teamStates[teamCode];
        if (!teamState || !pick || !pick.player) {
          return;
        }

        updateTeamStateAfterPick(teamState, pick.player);
      });
    }

    function createTeamState(teamCode) {
      return {
        team: normalizeTeamCode(teamCode),
        needProfile: {},
        draftedCountByPosition: {}
      };
    }

    function decidePick(context) {
      const pickInfo = context && context.pickInfo ? context.pickInfo : {};
      const availablePlayers = Array.isArray(context && context.availablePlayers)
        ? context.availablePlayers
        : [];
      const teamCode = normalizeTeamCode(context && context.teamCode);
      const teamState = context && context.teamState ? context.teamState : createTeamState(teamCode);

      const candidatePool = getCandidatePool(availablePlayers, teamState, pickInfo, config);
      const shortlist = generateShortlist(candidatePool, teamState, pickInfo, context, config);
      const scored = shortlist.map(function (player) {
        return scorePlayerForTeam(player, teamState, pickInfo, shortlist, context, config);
      });
      const finalists = getFinalists(sortByFinalScore(scored), config);

      const selected = pickWeightedRandom(finalists, config);
      const chosen = selected || finalists[0] || scored[0] || null;

      if (!chosen) {
        return {
          selectedPlayer: availablePlayers[0] || null,
          explanation: buildFallbackExplanation(teamCode, pickInfo),
          finalists: []
        };
      }

      const alternatives = finalists
        .filter(function (entry) { return entry.player.name !== chosen.player.name; })
        .slice(0, 3)
        .map(function (entry) {
          return {
            name: entry.player.name,
            position: entry.player.position,
            rank: entry.player.rank,
            finalScore: round2(entry.finalScore)
          };
        });

      const explanation = {
        team: teamCode,
        round: pickInfo.round,
        pick: pickInfo.pick,
        player: {
          name: chosen.player.name,
          position: chosen.player.position,
          rank: chosen.player.rank
        },
        final_score: round2(chosen.finalScore),
        team_fit_score: round2(chosen.teamFitScore),
        availability_score: round2(chosen.availabilityScore),
        availability_probability: round2(chosen.availabilityProbability),
        board_value_score: round2(chosen.boardValueScore),
        need_reasons: chosen.needReasons,
        alternatives: alternatives,
        reach_value_label: getReachValueLabel(chosen.reachPenalty, chosen.boardValueScore),
        consensus_notes: chosen.consensusNotes
      };

      if (config.featureFlags.debug) {
        explanation.debug = {
          finalists: finalists.map(function (entry) {
            return {
              name: entry.player.name,
              position: entry.player.position,
              rank: entry.player.rank,
              finalScore: round2(entry.finalScore),
              teamFitScore: round2(entry.teamFitScore),
              availabilityScore: round2(entry.availabilityScore),
              boardValueScore: round2(entry.boardValueScore),
              reachPenalty: round2(entry.reachPenalty),
              duplicatePenalty: round2(entry.duplicatePenalty)
            };
          })
        };
      }

      return {
        selectedPlayer: chosen.player,
        explanation: explanation,
        finalists: finalists
      };
    }

    function updateTeamStateAfterPick(teamState, player) {
      const position = normalizePositionCode(player && player.position);
      if (!teamState || !position) {
        return;
      }

      teamState.draftedCountByPosition[position] = (teamState.draftedCountByPosition[position] || 0) + 1;

      const matchedNeed = findMatchingNeed(position, teamState.needProfile);
      if (matchedNeed) {
        const prev = teamState.needProfile[matchedNeed] || 0;
        teamState.needProfile[matchedNeed] = Math.max(0, prev * config.scoring.needDecayFactor);
      }
    }

    return {
      config: config,
      initializeTeamStates: initializeTeamStates,
      rebuildTeamStatesFromPicks: rebuildTeamStatesFromPicks,
      createTeamState: createTeamState,
      decidePick: decidePick,
      updateTeamStateAfterPick: updateTeamStateAfterPick,
      matchesNeed: matchesNeed,
      findMatchingNeed: findMatchingNeed,
      getCandidatePoolSize: function (pickInfo) { return getCandidatePoolSize(pickInfo, config); },
      getCandidatePool: function (players, state, pickInfo) { return getCandidatePool(players, state, pickInfo, config); },
      estimateAvailability: function (player, pickInfo, context) {
        return estimateAvailability(player, pickInfo, context, config);
      },
      scorePlayerForTeam: function (player, teamState, pickInfo, shortlist, context) {
        return scorePlayerForTeam(player, teamState, pickInfo, shortlist, context, config);
      }
    };
  }

  function buildInitialNeedProfile(needs, config) {
    const profile = {};
    if (!Array.isArray(needs)) {
      return profile;
    }

    needs.forEach(function (need, index) {
      const key = normalizePositionCode(need);
      if (!key) {
        return;
      }

      const immediate = index < config.scoring.needWeightsImmediate.length
        ? config.scoring.needWeightsImmediate[index]
        : 0;
      const future = index < config.scoring.needWeightsFuture.length
        ? config.scoring.needWeightsFuture[index]
        : 0;
      profile[key] = immediate + future;
    });

    return profile;
  }

  function getCandidatePoolSize(pickInfo, config) {
    const overallPick = Number(pickInfo && pickInfo.pick) || 1;

    if (overallPick <= config.pool.earlyMaxPick) {
      return config.pool.earlySize;
    }

    if (overallPick <= config.pool.midMaxPick) {
      return config.pool.midSize;
    }

    return config.pool.lateSize;
  }

  function getCandidatePool(availablePlayers, teamState, pickInfo, config) {
    if (!Array.isArray(availablePlayers) || availablePlayers.length === 0) {
      return [];
    }

    const poolSize = getCandidatePoolSize(pickInfo, config);

    const filtered = availablePlayers
      .slice()
      .sort(function (a, b) {
        return getBoardRank(a, config) - getBoardRank(b, config);
      })
      .filter(function (player) {
        return !hasReachedPositionLimit(teamState, normalizePositionCode(player && player.position), config);
      })
      .slice(0, poolSize);

    if (filtered.length > 0) {
      return filtered;
    }

    return availablePlayers
      .slice()
      .sort(function (a, b) {
        return getBoardRank(a, config) - getBoardRank(b, config);
      })
      .slice(0, poolSize);
  }

  function generateShortlist(candidatePool, teamState, pickInfo, context, config) {
    if (!Array.isArray(candidatePool) || candidatePool.length === 0) {
      return [];
    }

    const preScored = candidatePool
      .map(function (player) {
        const boardValue = config.scoring.boardBase - getBoardRank(player, config);
        const needScore = getNeedScore(player, teamState, config);
        const posValue = getPositionalValueScore(player, config);
        const reachPenalty = getReachPenalty(getBoardRank(player, config), Number(pickInfo.pick) || 1, config);
        const availability = estimateAvailability(player, pickInfo, context, config);
        const preScore = boardValue + needScore + posValue + availability.score - reachPenalty;

        return { player: player, preScore: preScore };
      })
      .sort(function (a, b) {
        return b.preScore - a.preScore;
      });

    return preScored.slice(0, config.pool.shortlistSize).map(function (entry) {
      return entry.player;
    });
  }

  function scorePlayerForTeam(player, teamState, pickInfo, shortlist, context, config) {
    const boardRank = getBoardRank(player, config);
    const boardValueScore = config.scoring.boardBase - boardRank;
    const needBreakdown = getTeamNeedBreakdown(player, teamState, config);
    const positionalValueScore = getPositionalValueScore(player, config);
    const duplicatePenalty = getDuplicatePositionPenalty(player, teamState, config);
    const scarcityScore = getScarcityScore(player, shortlist, config);
    const reachPenalty = getReachPenalty(boardRank, Number(pickInfo.pick) || 1, config);

    const teamFitScore =
      boardValueScore +
      needBreakdown.needScore +
      positionalValueScore +
      needBreakdown.premiumBoost +
      needBreakdown.rosterFloorBoost +
      scarcityScore -
      duplicatePenalty;

    const availability = config.featureFlags.includeAvailabilityModel
      ? estimateAvailability(player, pickInfo, context, config)
      : { probability: 0.5, score: 50, notes: ["availability_fallback"] };

    const consensus = config.featureFlags.includeConsensusSignals
      ? getConsensusContextScore(player, pickInfo, context, config)
      : { score: 0, notes: [] };

    const randomness = config.featureFlags.includeRandomness
      ? getRandomIntInclusive(config.scoring.randomnessMin, config.scoring.randomnessMax)
      : 0;

    const finalScore =
      config.scoring.finalAlphaTeamFit * teamFitScore +
      config.scoring.finalBetaAvailability * availability.score +
      config.scoring.finalConsensusWeight * consensus.score +
      randomness -
      reachPenalty;

    return {
      player: player,
      finalScore: finalScore,
      teamFitScore: teamFitScore,
      availabilityScore: availability.score,
      availabilityProbability: availability.probability,
      boardValueScore: boardValueScore,
      needReasons: needBreakdown.reasons,
      reachPenalty: reachPenalty,
      duplicatePenalty: duplicatePenalty,
      consensusNotes: consensus.notes
    };
  }

  function sortByFinalScore(entries) {
    return entries.slice().sort(function (a, b) {
      return b.finalScore - a.finalScore;
    });
  }

  function getFinalists(scoredEntries, config) {
    return scoredEntries.slice(0, config.pool.finalistsCount);
  }

  function pickWeightedRandom(finalists, config) {
    if (!Array.isArray(finalists) || finalists.length === 0) {
      return null;
    }

    if (!config.featureFlags.includeRandomness || finalists.length === 1) {
      return finalists[0];
    }

    const weights = config.pool.finalistWeights.slice(0, finalists.length);
    const total = weights.reduce(function (sum, weight) { return sum + weight; }, 0);

    if (total <= 0) {
      return finalists[0];
    }

    let roll = Math.random() * total;

    for (let i = 0; i < finalists.length; i += 1) {
      roll -= weights[i] || 0;
      if (roll <= 0) {
        return finalists[i];
      }
    }

    return finalists[finalists.length - 1];
  }

  function estimateAvailability(player, pickInfo, context, config) {
    const overallPick = Number(pickInfo && pickInfo.pick) || 1;
    const expectedPick = estimateExpectedPick(player, config);
    const delta = expectedPick - overallPick;

    // Probabilidad de que el jugador siga disponible cuando llega este pick.
    const probability = 1 / (1 + Math.exp(-config.availability.logisticK * delta));

    // Convertimos disponibilidad a urgencia de selección (menos disponible = más score).
    const urgency = (1 - probability) * config.availability.scoreScale;

    const notes = [];
    if (hasNumber(player && player.adp)) {
      notes.push("adp_used");
    }
    if (hasNumber(player && player.consensus_rank)) {
      notes.push("consensus_rank_used");
    }
    if (!notes.length) {
      notes.push("rank_fallback");
    }

    return {
      probability: clamp(probability, 0, 1),
      score: urgency,
      expectedPick: expectedPick,
      notes: notes
    };
  }

  function estimateExpectedPick(player, config) {
    const weights = config.availability.expectedPickWeights;
    let weightedSum = 0;
    let totalWeight = 0;

    const rank = getBoardRank(player, config);
    weightedSum += rank * weights.rank;
    totalWeight += weights.rank;

    if (hasNumber(player && player.adp)) {
      weightedSum += Number(player.adp) * weights.adp;
      totalWeight += weights.adp;
    }

    if (hasNumber(player && player.consensus_rank)) {
      weightedSum += Number(player.consensus_rank) * weights.consensusRank;
      totalWeight += weights.consensusRank;
    }

    const mockRangeMid = getMockRangeMid(player);
    if (hasNumber(mockRangeMid)) {
      weightedSum += mockRangeMid * weights.mockRangeMid;
      totalWeight += weights.mockRangeMid;
    }

    if (totalWeight <= 0) {
      return rank;
    }

    return weightedSum / totalWeight;
  }

  function getConsensusContextScore(player, pickInfo, context, config) {
    const scoreParts = [];
    const notes = [];
    const pick = Number(pickInfo && pickInfo.pick) || 1;

    if (hasNumber(player && player.consensus_rank)) {
      const delta = Number(player.consensus_rank) - getBoardRank(player, config);
      scoreParts.push(-delta / config.consensus.boardAlignmentScale);
      notes.push("consensus_board_alignment");
    }

    const range = getMockRange(player);
    if (range) {
      if (pick >= range.min && pick <= range.max) {
        scoreParts.push(config.consensus.rangeAlignmentBonus);
        notes.push("consensus_range_match");
      } else {
        scoreParts.push(-config.consensus.rangeMissPenalty);
        notes.push("consensus_range_miss");
      }
    }

    if (hasNumber(player && player.projected_round)) {
      const projectedRound = Number(player.projected_round);
      const actualRound = Number(pickInfo && pickInfo.round) || getRoundFromPick(pick);
      if (projectedRound === actualRound) {
        scoreParts.push(config.consensus.projectedRoundBonus);
        notes.push("projected_round_match");
      } else {
        scoreParts.push(-config.consensus.projectedRoundMissPenalty);
        notes.push("projected_round_miss");
      }
    }

    const teamCode = normalizeTeamCode(context && context.teamCode);
    const affinity = getTeamMockAffinity(player, teamCode);
    if (hasNumber(affinity)) {
      scoreParts.push(Number(affinity) * config.consensus.teamMockAffinityScale);
      notes.push("team_mock_affinity");
    }

    return {
      score: scoreParts.reduce(function (sum, entry) { return sum + entry; }, 0),
      notes: notes
    };
  }

  function getTeamNeedBreakdown(player, teamState, config) {
    const position = normalizePositionCode(player && player.position);
    const matchedNeed = findMatchingNeed(position, teamState && teamState.needProfile);
    const needScore = matchedNeed ? Number(teamState.needProfile[matchedNeed] || 0) : 0;

    const premiumBoost = Object.prototype.hasOwnProperty.call(config.scoring.premiumPositionBoost, position)
      ? config.scoring.premiumPositionBoost[position]
      : 0;

    const rosterFloorBoost = getRosterFloorBoost(position, teamState, config);

    const reasons = [];
    if (matchedNeed) {
      reasons.push("need_match:" + matchedNeed + ":" + round2(needScore));
    }
    if (premiumBoost) {
      reasons.push("premium_position:" + position);
    }
    if (rosterFloorBoost) {
      reasons.push("roster_floor:" + position);
    }

    return {
      needScore: needScore,
      premiumBoost: premiumBoost,
      rosterFloorBoost: rosterFloorBoost,
      reasons: reasons
    };
  }

  function getNeedScore(player, teamState, config) {
    const breakdown = getTeamNeedBreakdown(player, teamState, config);
    return breakdown.needScore;
  }

  function getPositionalValueScore(player, config) {
    const position = normalizePositionCode(player && player.position);
    if (!position) {
      return 0;
    }

    return Object.prototype.hasOwnProperty.call(config.scoring.positionValueMap, position)
      ? config.scoring.positionValueMap[position]
      : 0;
  }

  function getRosterFloorBoost(position, teamState, config) {
    const minDepth = config.scoring.minDepthByPosition[position];
    if (!hasNumber(minDepth)) {
      return 0;
    }

    const draftedCount = (teamState && teamState.draftedCountByPosition && teamState.draftedCountByPosition[position]) || 0;
    if (draftedCount >= minDepth) {
      return 0;
    }

    return config.scoring.rosterFloorBoost[position] || 0;
  }

  function getDuplicatePositionPenalty(player, teamState, config) {
    const position = normalizePositionCode(player && player.position);
    if (!position || !teamState || !teamState.draftedCountByPosition) {
      return 0;
    }

    const count = teamState.draftedCountByPosition[position] || 0;
    const penalties = config.scoring.duplicatePositionPenalties;

    if (count <= 0) {
      return 0;
    }

    if (count < penalties.length) {
      return penalties[count];
    }

    return penalties[penalties.length - 1];
  }

  function hasReachedPositionLimit(teamState, position, config) {
    if (!teamState || !teamState.draftedCountByPosition || !position) {
      return false;
    }

    if (!Object.prototype.hasOwnProperty.call(config.scoring.maxPositionCounts, position)) {
      return false;
    }

    const count = teamState.draftedCountByPosition[position] || 0;
    return count >= config.scoring.maxPositionCounts[position];
  }

  function getReachPenalty(boardRank, overallPick, config) {
    if (!hasNumber(boardRank) || !hasNumber(overallPick)) {
      return 0;
    }

    const expectedRank = overallPick + config.scoring.reachOffset;
    const delta = boardRank - expectedRank;

    if (delta <= 0) {
      return 0;
    }

    return delta * config.scoring.reachPenaltyMultiplier;
  }

  function getScarcityScore(player, shortlist, config) {
    if (!player || !Array.isArray(shortlist)) {
      return 0;
    }

    const position = normalizePositionCode(player.position);
    if (!position) {
      return 0;
    }

    const rankCeiling = getBoardRank(player, config) + config.scoring.scarcityRankWindow;

    const count = shortlist.filter(function (entry) {
      return normalizePositionCode(entry.position) === position && getBoardRank(entry, config) <= rankCeiling;
    }).length;

    if (count <= config.scoring.scarcityThresholdHigh) {
      return config.scoring.scarcityBonusHigh;
    }

    if (count <= config.scoring.scarcityThresholdLow) {
      return config.scoring.scarcityBonusLow;
    }

    return 0;
  }

  function findMatchingNeed(playerPosition, needProfile) {
    if (!needProfile || typeof needProfile !== "object") {
      return null;
    }

    const position = normalizePositionCode(playerPosition);
    if (!position) {
      return null;
    }

    let selectedNeed = null;
    let maxWeight = -1;

    Object.keys(needProfile).forEach(function (need) {
      const weight = Number(needProfile[need]) || 0;
      if (matchesNeed(position, need) && weight > maxWeight) {
        maxWeight = weight;
        selectedNeed = need;
      }
    });

    return selectedNeed;
  }

  function matchesNeed(playerPosition, need) {
    const pos = normalizePositionCode(playerPosition);
    const normalizedNeed = normalizePositionCode(need);

    if (!pos || !normalizedNeed) {
      return false;
    }

    if (pos === normalizedNeed) {
      return true;
    }

    if (normalizedNeed === "OL" && (pos === "OT" || pos === "IOL")) {
      return true;
    }

    if (normalizedNeed === "DB" && (pos === "CB" || pos === "S")) {
      return true;
    }

    return false;
  }

  function getBoardRank(player, config) {
    if (hasNumber(player && player.rank)) {
      return Number(player.rank);
    }

    if (hasNumber(player && player.consensus_rank)) {
      return Number(player.consensus_rank);
    }

    if (hasNumber(player && player.adp)) {
      return Number(player.adp);
    }

    return config.scoring.boardRankFallback;
  }

  function getMockRange(player) {
    if (hasNumber(player && player.mock_range_min) && hasNumber(player && player.mock_range_max)) {
      return {
        min: Number(player.mock_range_min),
        max: Number(player.mock_range_max)
      };
    }

    if (Array.isArray(player && player.consensus_mock_range) && player.consensus_mock_range.length === 2) {
      const min = Number(player.consensus_mock_range[0]);
      const max = Number(player.consensus_mock_range[1]);
      if (hasNumber(min) && hasNumber(max)) {
        return { min: min, max: max };
      }
    }

    return null;
  }

  function getMockRangeMid(player) {
    const range = getMockRange(player);
    if (!range) {
      return null;
    }

    return (range.min + range.max) / 2;
  }

  function getTeamMockAffinity(player, teamCode) {
    if (!player || !teamCode) {
      return null;
    }

    if (player.team_mock_affinity && typeof player.team_mock_affinity === "object") {
      const value = player.team_mock_affinity[teamCode];
      return hasNumber(value) ? Number(value) : null;
    }

    return null;
  }

  function getRoundFromPick(overallPick) {
    if (!hasNumber(overallPick) || overallPick <= 0) {
      return 1;
    }

    return Math.ceil(overallPick / 32);
  }

  function getReachValueLabel(reachPenalty, boardValueScore) {
    if (reachPenalty >= 45) {
      return "reach_fuerte";
    }

    if (reachPenalty >= 15) {
      return "reach_moderado";
    }

    if (boardValueScore >= 1400) {
      return "value_elite";
    }

    return "value_normal";
  }

  function buildFallbackExplanation(teamCode, pickInfo) {
    return {
      team: teamCode,
      round: pickInfo && pickInfo.round,
      pick: pickInfo && pickInfo.pick,
      note: "fallback_selection",
      final_score: 0,
      team_fit_score: 0,
      availability_score: 0,
      board_value_score: 0,
      need_reasons: [],
      alternatives: [],
      reach_value_label: "fallback",
      consensus_notes: []
    };
  }

  function normalizePositionCode(value) {
    return typeof value === "string" ? value.trim().toUpperCase() : "";
  }

  function normalizeTeamCode(value) {
    return typeof value === "string" ? value.trim().toUpperCase() : "";
  }

  function round2(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function clamp(value, min, max) {
    if (value < min) {
      return min;
    }

    if (value > max) {
      return max;
    }

    return value;
  }

  function hasNumber(value) {
    return typeof value === "number" && !Number.isNaN(value) && Number.isFinite(value);
  }

  function getRandomIntInclusive(min, max) {
    const lower = Math.ceil(min);
    const upper = Math.floor(max);
    return Math.floor(Math.random() * (upper - lower + 1)) + lower;
  }

  function mergeDeep(base, override) {
    if (!override || typeof override !== "object") {
      return clone(base);
    }

    const output = Array.isArray(base) ? base.slice() : Object.assign({}, base);

    Object.keys(override).forEach(function (key) {
      const baseValue = base ? base[key] : undefined;
      const overrideValue = override[key];

      if (Array.isArray(overrideValue)) {
        output[key] = overrideValue.slice();
        return;
      }

      if (overrideValue && typeof overrideValue === "object") {
        output[key] = mergeDeep(baseValue || {}, overrideValue);
        return;
      }

      output[key] = overrideValue;
    });

    return output;
  }

  function clone(value) {
    if (Array.isArray(value)) {
      return value.slice();
    }

    if (value && typeof value === "object") {
      return Object.assign({}, value);
    }

    return value;
  }

  return {
    DEFAULT_ENGINE_CONFIG: DEFAULT_ENGINE_CONFIG,
    createDraftAutopickEngine: createDraftAutopickEngine,
    matchesNeed: matchesNeed
  };
});
