(function () {
  "use strict";

  // Configuracion principal y parametros de scoring del autopick.
  const STORAGE_KEY = "draftSimulator.current";
  const STATE_VERSION = 1;
  const USER_TEAM = "MIA";

  // Tamaño del pool de candidatos segun el numero de pick global.
  const CANDIDATE_POOL_EARLY = 20;
  const CANDIDATE_POOL_MID = 30;
  const CANDIDATE_POOL_LATE = 40;

  // Finalistas y pesos para weighted random (1º al 5º).
  const FINALIST_COUNT = 5;
  const FINALIST_WEIGHTS = [40, 25, 18, 10, 7];

  // Pesos iniciales de need por orden de prioridad (primera need = maximo).
  const INITIAL_NEED_WEIGHTS = [100, 70, 45, 20, 10];

  // Decaimiento del peso de una need tras draftear esa posicion.
  const NEED_WEIGHT_DECAY = 0.25;

  // Valor posicional fijo para cada posicion.
  const POSITION_VALUE_MAP = {
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
  };

  // Aleatoridad controlada.
  const RANDOMNESS_MIN = 0;
  const RANDOMNESS_MAX = 20;

  // Penalizacion por reach (rank peor que lo esperado para ese pick).
  const REACH_OFFSET = 8;
  const REACH_PENALTY_MULTIPLIER = 3;

  // Limite maximo de jugadores por posicion por equipo.
  const MAX_POSITION_COUNTS = {
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
  };

  // Penalizacion progresiva por repetir posicion (indice = picks previos en esa posicion).
  const DUPLICATE_POSITION_PENALTIES = [0, 12, 28, 50];

  // Bonus de escasez posicional: cuantos jugadores similares quedan en el pool.
  const SCARCITY_RANK_WINDOW = 30;
  const SCARCITY_THRESHOLD_HIGH = 2;
  const SCARCITY_THRESHOLD_LOW = 5;
  const SCARCITY_BONUS_HIGH = 15;
  const SCARCITY_BONUS_LOW = 8;

  const DEBUG_AUTOPICK = false;
  const AUTOPICK_ENGINE_MODE = "pipeline";
  const AUTOPICK_PIPELINE_CONFIG = {
    featureFlags: {
      usePipelineEngine: true,
      includeConsensusSignals: true,
      includeAvailabilityModel: true,
      includeRandomness: true,
      debug: DEBUG_AUTOPICK
    }
  };

  const DATA_URLS = {
    players: "/data/draft/players.json",
    teamNeeds: "/data/draft/team_needs.json",
    draftOrder: "/data/draft/draft_order.json"
  };

  const AUTO_PICK_SPEEDS = {
    "very-fast": { label: "Muy rapida", delayMs: 250 },
    fast: { label: "Rapida", delayMs: 1000 },
    slow: { label: "Lenta", delayMs: 2000 },
    "very-slow": { label: "Muy lenta", delayMs: 5000 }
  };
  const DEFAULT_AUTO_PICK_SPEED = "very-fast";

  const TEAM_DISPLAY_NAMES = {
    ARI: "Arizona Cardinals",
    ATL: "Atlanta Falcons",
    BAL: "Baltimore Ravens",
    BUF: "Buffalo Bills",
    CAR: "Carolina Panthers",
    CHI: "Chicago Bears",
    CIN: "Cincinnati Bengals",
    CLE: "Cleveland Browns",
    DAL: "Dallas Cowboys",
    DEN: "Denver Broncos",
    DET: "Detroit Lions",
    GB: "Green Bay Packers",
    HOU: "Houston Texans",
    IND: "Indianapolis Colts",
    JAX: "Jacksonville Jaguars",
    KC: "Kansas City Chiefs",
    LAC: "Los Angeles Chargers",
    LAR: "Los Angeles Rams",
    LV: "Las Vegas Raiders",
    MIA: "Miami Dolphins",
    MIN: "Minnesota Vikings",
    NE: "New England Patriots",
    NO: "New Orleans Saints",
    NYG: "New York Giants",
    NYJ: "New York Jets",
    PHI: "Philadelphia Eagles",
    PIT: "Pittsburgh Steelers",
    SEA: "Seattle Seahawks",
    SF: "San Francisco 49ers",
    TB: "Tampa Bay Buccaneers",
    TEN: "Tennessee Titans",
    WAS: "Washington Commanders"
  };

  const app = {
    data: null,
    state: null,
    teamStates: {},
    autopickEngine: null,
    playersByName: new Map(),
    autoRun: {
      active: false,
      token: 0
    },
    ui: {
      searchTerm: "",
      positionFilter: "ALL",
      picksTeamFilter: "ALL",
      autoPickSpeed: DEFAULT_AUTO_PICK_SPEED,
      lastRenderedLatestPickKey: ""
    },
    elements: {}
  };

  document.addEventListener("DOMContentLoaded", init);

  // Flujo de arranque: cargar datos y restaurar estado sin iniciar automaticamente.
  async function init() {
    cacheElements();
    bindEvents();
    setMessage("Cargando datos...");

    try {
      app.data = await loadAllData();
      app.playersByName = buildPlayersByName(app.data.players);
      app.autopickEngine = createAutopickEngine();
      resetTeamStates();
      populatePositionFilter(app.data.players);
        populateCompletedPicksTeamFilter(app.data.draftOrder);

      const savedState = loadStateFromStorage();
      if (savedState) {
        app.state = savedState;
        app.ui.autoPickSpeed = normalizeAutoPickSpeed(savedState.autoPickSpeed);
        rebuildTeamStatesFromPicks(app.state.picks);
        setMessage("Simulacion restaurada desde localStorage.");
      } else {
        app.state = createInitialState();
        persistState();
        setMessage("Nueva simulacion preparada. Pulsa Iniciar draft.");
      }

      syncAutoPickSpeedControl();
      renderAll();
    } catch (error) {
      showError(error.message || "Error inesperado al inicializar el simulador.");
    }
  }

  // Referencias a nodos del DOM.
  function cacheElements() {
    app.elements.onClockIndicator = document.getElementById("on-clock-indicator");
    app.elements.currentRound = document.getElementById("current-round");
    app.elements.currentPick = document.getElementById("current-pick");
    app.elements.currentTeam = document.getElementById("current-team");
    app.elements.draftStateLabel = document.getElementById("draft-state-label");
    app.elements.draftMessage = document.getElementById("draft-message");
    app.elements.draftError = document.getElementById("draft-error");

    app.elements.completedPicksList = document.getElementById("completed-picks-list");
    app.elements.availablePlayersList = document.getElementById("available-players-list");

    app.elements.playerSearch = document.getElementById("player-search");
    app.elements.positionFilter = document.getElementById("position-filter");
    app.elements.completedPicksTeamFilter = document.getElementById("completed-picks-team-filter");
    app.elements.autoPickSpeed = document.getElementById("auto-pick-speed");
    app.elements.btnPicksFilterAll = document.getElementById("btn-picks-filter-all");
    app.elements.btnPicksFilterMiami = document.getElementById("btn-picks-filter-miami");

    app.elements.miamiPickCard = document.getElementById("miami-pick-card");
    app.elements.miamiPickSlot = document.getElementById("miami-pick-slot");
    app.elements.miamiPickName = document.getElementById("miami-pick-name");
    app.elements.miamiPickMeta = document.getElementById("miami-pick-meta");
    app.elements.miamiPickRank = document.getElementById("miami-pick-rank");

    app.elements.btnStartDraft = document.getElementById("btn-start-draft");
    app.elements.btnSimNextMiami = document.getElementById("btn-sim-next-miami");
    app.elements.btnContinue = document.getElementById("btn-continue");
    app.elements.btnExportCsv = document.getElementById("btn-export-csv");
    app.elements.btnImportCsv = document.getElementById("btn-import-csv");
    app.elements.importCsvInput = document.getElementById("import-csv-input");
    app.elements.btnReset = document.getElementById("btn-reset");
    app.elements.btnClear = document.getElementById("btn-clear");
  }

  // Eventos de UI: filtros, acciones y seleccion manual de Miami.
  function bindEvents() {
    app.elements.playerSearch.addEventListener("input", function (event) {
      app.ui.searchTerm = (event.target.value || "").trim().toLowerCase();
      renderAvailablePlayers();
    });

    app.elements.positionFilter.addEventListener("change", function (event) {
      app.ui.positionFilter = event.target.value || "ALL";
      renderAvailablePlayers();
    });

    app.elements.completedPicksTeamFilter.addEventListener("change", function (event) {
      app.ui.picksTeamFilter = event.target.value || "ALL";
      renderCompletedPicks();
    });

    app.elements.autoPickSpeed.addEventListener("change", function (event) {
      app.ui.autoPickSpeed = normalizeAutoPickSpeed(event.target.value);
      if (app.state) {
        app.state.autoPickSpeed = app.ui.autoPickSpeed;
        persistState();
      }
      setMessage("Velocidad automatica configurada en " + getCurrentAutoPickSpeedLabel() + ".");
    });

    app.elements.btnPicksFilterAll.addEventListener("click", function () {
      setCompletedPicksTeamFilter("ALL");
    });

    app.elements.btnPicksFilterMiami.addEventListener("click", function () {
      setCompletedPicksTeamFilter(USER_TEAM);
    });

    app.elements.btnStartDraft.addEventListener("click", async function () {
      if (!app.data || !app.state || app.state.completed) {
        return;
      }

      if (app.state.started) {
        setMessage("El draft ya fue iniciado.");
        return;
      }

      app.state.started = true;
      persistState();
      setMessage("Draft iniciado.");
      renderAll();

      if (!isMiamiOnClock()) {
        await runAutoUntilMiamiOrComplete();
        renderAll();
      }
    });

    app.elements.btnSimNextMiami.addEventListener("click", async function () {
      if (ensureLoadedAndNotCompleted()) {
        if (isMiamiOnClock()) {
          setMessage("Miami Dolphins ya esta on the clock. Selecciona un jugador.");
          renderAll();
          return;
        }

        await runAutoUntilMiamiOrComplete();
        renderAll();
      }
    });

    app.elements.btnContinue.addEventListener("click", async function () {
      if (ensureLoadedAndNotCompleted()) {
        if (isMiamiOnClock()) {
          setMessage("Le toca a Miami Dolphins. Debes seleccionar un jugador para continuar.");
          renderAll();
          return;
        }

        await stepAutoPickOnce();
        renderAll();
      }
    });

    app.elements.btnExportCsv.addEventListener("click", function () {
      exportMockDraftToCsv();
    });

    app.elements.btnImportCsv.addEventListener("click", function () {
      if (app.elements.importCsvInput) {
        app.elements.importCsvInput.click();
      }
    });

    app.elements.importCsvInput.addEventListener("change", async function (event) {
      const file = event.target && event.target.files ? event.target.files[0] : null;

      if (!file) {
        return;
      }

      await importMockDraftFromCsvFile(file);
      event.target.value = "";
    });

    app.elements.btnReset.addEventListener("click", async function () {
      if (!app.data) {
        return;
      }

      cancelAutoRun();
      resetTeamStates();
      app.state = createInitialState();
      clearLatestMiamiPickDisplay();
      persistState();
      setMessage("Draft reiniciado. Pulsa Iniciar draft.");
      renderAll();
    });

    app.elements.btnClear.addEventListener("click", async function () {
      cancelAutoRun();

      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        showError("No se pudo borrar el progreso guardado en localStorage.");
        return;
      }

      if (!app.data) {
        return;
      }

      resetTeamStates();
      app.state = createInitialState();
      clearLatestMiamiPickDisplay();
      persistState();
      setMessage("Progreso borrado. Pulsa Iniciar draft para comenzar.");
      renderAll();
    });

    app.elements.availablePlayersList.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-player-name]");
      if (!button) {
        return;
      }

      const playerName = button.getAttribute("data-player-name");
      handleMiamiManualPick(playerName);
    });
  }

  // Carga de datos estaticos JSON.
  async function loadAllData() {
    const [players, teamNeeds, draftOrder] = await Promise.all([
      fetchJsonFile(DATA_URLS.players, "players.json"),
      fetchJsonFile(DATA_URLS.teamNeeds, "team_needs.json"),
      fetchJsonFile(DATA_URLS.draftOrder, "draft_order.json")
    ]);

    validatePlayers(players);
    validateTeamNeeds(teamNeeds);
    validateDraftOrder(draftOrder);

    return {
      players: players,
      teamNeeds: teamNeeds,
      draftOrder: draftOrder
    };
  }

  async function fetchJsonFile(url, label) {
    let response;

    try {
      response = await fetch(url, { cache: "no-store" });
    } catch (error) {
      throw new Error("Error al cargar " + label + ". Verifica que el archivo exista y sea accesible.");
    }

    if (!response.ok) {
      throw new Error("Error al cargar " + label + ". Estado HTTP: " + response.status + ".");
    }

    try {
      return await response.json();
    } catch (error) {
      throw new Error("El archivo " + label + " no contiene JSON valido.");
    }
  }

  function validatePlayers(players) {
    if (!Array.isArray(players) || players.length === 0) {
      throw new Error("players.json debe ser un array no vacio.");
    }

    const seenNames = new Set();
    players.forEach(function (player, index) {
      if (!player || typeof player !== "object") {
        throw new Error("players.json tiene una entrada invalida en el indice " + index + ".");
      }

      if (typeof player.name !== "string" || !player.name.trim()) {
        throw new Error("players.json tiene un jugador sin nombre valido en el indice " + index + ".");
      }

      if (typeof player.position !== "string" || !player.position.trim()) {
        throw new Error("players.json tiene un jugador sin posicion valida en el indice " + index + ".");
      }

      if (typeof player.college !== "string" || !player.college.trim()) {
        throw new Error("players.json tiene un jugador sin college valido en el indice " + index + ".");
      }

      if (typeof player.rank !== "number" || Number.isNaN(player.rank)) {
        throw new Error("players.json tiene un jugador sin rank numerico valido en el indice " + index + ".");
      }

      const normalizedName = player.name.trim().toLowerCase();
      if (seenNames.has(normalizedName)) {
        throw new Error("players.json contiene jugadores duplicados por nombre: " + player.name + ".");
      }
      seenNames.add(normalizedName);
    });
  }

  function validateTeamNeeds(teamNeeds) {
    if (!Array.isArray(teamNeeds)) {
      throw new Error("team_needs.json debe ser un array.");
    }

    teamNeeds.forEach(function (entry, index) {
      if (!entry || typeof entry !== "object") {
        throw new Error("team_needs.json tiene una entrada invalida en el indice " + index + ".");
      }

      if (typeof entry.team !== "string" || !entry.team.trim()) {
        throw new Error("team_needs.json tiene una entrada sin team valido en el indice " + index + ".");
      }

      if (!Array.isArray(entry.needs)) {
        throw new Error("team_needs.json tiene una entrada sin needs array en el indice " + index + ".");
      }
    });
  }

  function validateDraftOrder(draftOrder) {
    if (!Array.isArray(draftOrder) || draftOrder.length === 0) {
      throw new Error("draft_order.json debe ser un array no vacio.");
    }

    let previousRound = 0;
    let previousPick = 0;

    draftOrder.forEach(function (entry, index) {
      if (!entry || typeof entry !== "object") {
        throw new Error("draft_order.json tiene una entrada invalida en el indice " + index + ".");
      }

      if (typeof entry.round !== "number" || Number.isNaN(entry.round)) {
        throw new Error("draft_order.json tiene una entrada sin round valido en el indice " + index + ".");
      }

      if (typeof entry.pick !== "number" || Number.isNaN(entry.pick)) {
        throw new Error("draft_order.json tiene una entrada sin pick valido en el indice " + index + ".");
      }

      if (typeof entry.team !== "string" || !entry.team.trim()) {
        throw new Error("draft_order.json tiene una entrada sin team valido en el indice " + index + ".");
      }

      if (index > 0) {
        const isOutOfOrder =
          entry.round < previousRound ||
          (entry.round === previousRound && entry.pick < previousPick);

        if (isOutOfOrder) {
          throw new Error("draft_order.json debe estar ordenado por round y pick ascendente.");
        }
      }

      previousRound = entry.round;
      previousPick = entry.pick;
    });
  }

  function buildPlayersByName(players) {
    const map = new Map();
    players.forEach(function (player) {
      map.set(player.name, player);
    });
    return map;
  }

  // Estado persistente del simulador guardado en localStorage.
  function createInitialState() {
    return {
      version: STATE_VERSION,
      started: false,
      currentPickIndex: 0,
      completed: false,
      userTeam: USER_TEAM,
      autoPickSpeed: normalizeAutoPickSpeed(app.ui.autoPickSpeed),
      picks: [],
      selectedPlayerNames: [],
      pickExplanations: []
    };
  }

  function loadStateFromStorage() {
    let raw;

    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      showError("No se pudo leer localStorage. Se usara una simulacion nueva.");
      return null;
    }

    if (!raw) {
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      showError("Estado guardado invalido. Se creara una simulacion nueva.");
      return null;
    }

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (parsed.version !== STATE_VERSION) {
      return null;
    }

    if (!Array.isArray(parsed.picks) || !Array.isArray(parsed.selectedPlayerNames)) {
      return null;
    }

    if (parsed.pickExplanations && !Array.isArray(parsed.pickExplanations)) {
      return null;
    }

    if (typeof parsed.currentPickIndex !== "number" || parsed.currentPickIndex < 0) {
      return null;
    }

    if (typeof parsed.completed !== "boolean") {
      return null;
    }

    const maxPickIndex = app.data ? app.data.draftOrder.length : Number.MAX_SAFE_INTEGER;
    if (parsed.currentPickIndex > maxPickIndex) {
      return null;
    }

    return {
      version: STATE_VERSION,
      started: typeof parsed.started === "boolean" ? parsed.started : parsed.currentPickIndex > 0,
      currentPickIndex: parsed.currentPickIndex,
      completed: parsed.completed,
      userTeam: USER_TEAM,
      autoPickSpeed: normalizeAutoPickSpeed(parsed.autoPickSpeed),
      picks: parsed.picks,
      selectedPlayerNames: parsed.selectedPlayerNames,
      pickExplanations: Array.isArray(parsed.pickExplanations) ? parsed.pickExplanations : []
    };
  }

  function persistState() {
    if (!app.state) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state));
    } catch (error) {
      showError("No se pudo guardar el progreso en localStorage.");
    }
  }

  function getCurrentDraftEntry() {
    if (!app.state || app.state.completed) {
      return null;
    }

    return app.data.draftOrder[app.state.currentPickIndex] || null;
  }

  function isMiamiOnClock() {
    const entry = getCurrentDraftEntry();
    return Boolean(entry && normalizeTeamCode(entry.team) === USER_TEAM);
  }

  function ensureLoadedAndNotCompleted() {
    if (!app.data || !app.state) {
      setMessage("Aun no se termino de cargar el simulador.");
      return false;
    }

    if (!app.state.started) {
      setMessage("Pulsa Iniciar draft para comenzar.");
      return false;
    }

    if (app.state.completed) {
      setMessage("El draft ya esta completado.");
      return false;
    }

    return true;
  }

  // Simulacion automatica hasta siguiente turno de Miami o fin del draft.
  async function runAutoUntilMiamiOrComplete() {
    if (!app.data || !app.state || app.state.completed) {
      return;
    }

    const token = beginAutoRun();
    let safetyCounter = 0;
    const safetyLimit = app.data.draftOrder.length + 5;

    while (!app.state.completed && !isMiamiOnClock() && isAutoRunTokenActive(token)) {
      const pickResult = processAutoPickForCurrentTeam();
      renderAll();
      persistState();
      safetyCounter += 1;

      if (pickResult && !app.state.completed && !isMiamiOnClock()) {
        await waitForAutoPickDelay(token);
      }

      if (safetyCounter > safetyLimit) {
        showError("Se detecto un ciclo inesperado al avanzar el draft.");
        break;
      }
    }

    if (isAutoRunTokenActive(token)) {
      finishAutoRun(token);
    }

    if (app.state.completed) {
      setMessage("Draft completado.");
    }
  }

  // Avance manual de un pick automatico cuando no esta Miami on the clock.
  async function stepAutoPickOnce() {
    if (!app.data || !app.state || app.state.completed || isMiamiOnClock()) {
      return;
    }

    const token = beginAutoRun();
    processAutoPickForCurrentTeam();
    if (isAutoRunTokenActive(token)) {
      finishAutoRun(token);
    }
    renderAll();
    persistState();

    if (app.state.completed) {
      setMessage("Draft completado.");
    } else {
      const current = getCurrentDraftEntry();
      if (current) {
        setMessage("Avanzado a R" + current.round + " Pick " + current.pick + " (" + getTeamDisplayName(current.team) + ").");
      }
    }
  }

  function processAutoPickForCurrentTeam() {
    const currentEntry = getCurrentDraftEntry();
    if (!currentEntry) {
      app.state.completed = true;
      return null;
    }

    const teamCode = normalizeTeamCode(currentEntry.team);
    const availablePlayers = getAvailablePlayers();

    if (availablePlayers.length === 0) {
      app.state.completed = true;
      setMessage("No quedan jugadores disponibles para continuar el draft.");
      return null;
    }

    const selected = autoPickForTeam(teamCode, currentEntry, availablePlayers);

    applyPick(currentEntry, selected.player, true);
    updateTeamStateAfterPick(teamCode, selected.player);

    if (selected.explanation) {
      app.state.pickExplanations.push(selected.explanation);
    }

    setMessage(getTeamDisplayName(currentEntry.team) + " seleccionan a " + selected.player.name + " (" + selected.player.position + ").");

    return {
      draftEntry: currentEntry,
      player: selected.player
    };
  }

  // Algoritmo de autopick con compatibilidad: motor pipeline (nuevo) + fallback legado.
  function autoPickForTeam(teamCode, draftEntry, availablePlayers) {
    if (isPipelineEngineEnabled()) {
      const teamState = ensureTeamState(teamCode);
      const decision = app.autopickEngine.decidePick({
        teamCode: teamCode,
        pickInfo: {
          round: draftEntry && draftEntry.round,
          pick: draftEntry && draftEntry.pick
        },
        availablePlayers: availablePlayers,
        teamState: teamState
      });

      return {
        player: decision.selectedPlayer,
        finalScore: decision.explanation ? decision.explanation.final_score : 0,
        explanation: decision.explanation || null
      };
    }

    return autoPickForTeamLegacy(teamCode, draftEntry, availablePlayers);
  }

  // Motor legado (score unico) mantenido para comparacion y backward compatibility.
  function autoPickForTeamLegacy(teamCode, draftEntry, availablePlayers) {
    const teamState = app.teamStates[teamCode] || createFreshTeamState(teamCode);
    const candidatePool = getCandidatePool(availablePlayers, teamState, draftEntry);

    // Si todos los jugadores superan el limite de posicion, usar pool sin restricciones.
    const effectivePool = candidatePool.length > 0
      ? candidatePool
      : getCandidatePoolUnrestricted(availablePlayers, draftEntry);

    if (effectivePool.length === 0) {
      return { player: availablePlayers[0], finalScore: 0 };
    }

    const scoredCandidates = scoreCandidates(effectivePool, teamState, draftEntry);
    const sortedCandidates = sortCandidatesByScore(scoredCandidates);
    const finalists = getFinalists(sortedCandidates);
    const selectedCandidate = pickWeightedRandom(finalists) || sortedCandidates[0] || null;

    if (!selectedCandidate) {
      return { player: availablePlayers[0], finalScore: 0 };
    }

    if (DEBUG_AUTOPICK) {
      logAutoPickDebug(teamCode, draftEntry, finalists, selectedCandidate);
    }

    return {
      player: selectedCandidate.player,
      finalScore: selectedCandidate.scoreData.finalScore
    };
  }

  function createAutopickEngine() {
    if (typeof window === "undefined" || !window.DraftAutopickEngine) {
      return null;
    }

    return window.DraftAutopickEngine.createDraftAutopickEngine(AUTOPICK_PIPELINE_CONFIG);
  }

  function isPipelineEngineEnabled() {
    return AUTOPICK_ENGINE_MODE === "pipeline" && Boolean(app.autopickEngine);
  }

  function ensureTeamState(teamCode) {
    if (!app.teamStates[teamCode]) {
      app.teamStates[teamCode] = isPipelineEngineEnabled()
        ? app.autopickEngine.createTeamState(teamCode)
        : createFreshTeamState(teamCode);
    }

    return app.teamStates[teamCode];
  }

  function resetTeamStates() {
    if (!app.data) {
      app.teamStates = {};
      return;
    }

    if (isPipelineEngineEnabled()) {
      app.teamStates = app.autopickEngine.initializeTeamStates(app.data.teamNeeds);
      return;
    }

    app.teamStates = buildTeamStates(app.data.teamNeeds);
  }

  // Inicializa el estado interno (needWeights + contadores) de todos los equipos.
  function buildTeamStates(teamNeeds) {
    const states = {};

    if (Array.isArray(teamNeeds)) {
      teamNeeds.forEach(function (entry) {
        const teamCode = normalizeTeamCode(entry.team);
        states[teamCode] = {
          teamCode: teamCode,
          needWeights: buildInitialNeedWeights(entry.needs),
          draftedCountByPosition: {}
        };
      });
    }

    return states;
  }

  function createFreshTeamState(teamCode) {
    return {
      teamCode: teamCode,
      needWeights: {},
      draftedCountByPosition: {}
    };
  }

  // Reconstruye el teamState de cada equipo reproduciendo los picks ya guardados en localStorage.
  function rebuildTeamStatesFromPicks(picks) {
    if (isPipelineEngineEnabled()) {
      app.autopickEngine.rebuildTeamStatesFromPicks(app.teamStates, picks);
      return;
    }

    if (!Array.isArray(picks) || picks.length === 0) {
      return;
    }

    picks.forEach(function (pickEntry) {
      if (!pickEntry || !pickEntry.player) {
        return;
      }

      const teamCode = normalizeTeamCode(pickEntry.team);
      const teamState = app.teamStates[teamCode];

      if (teamState) {
        applyTeamStateUpdateLegacy(teamState, { position: pickEntry.player.position });
      }
    });
  }

  // Convierte el array de needs en un mapa de pesos numericos decrecientes.
  function buildInitialNeedWeights(needsArray) {
    if (!Array.isArray(needsArray) || needsArray.length === 0) {
      return {};
    }

    const weights = {};

    needsArray.forEach(function (need, index) {
      const normalizedNeed = normalizePositionCode(need);
      if (!normalizedNeed) {
        return;
      }

      const bonus = index < INITIAL_NEED_WEIGHTS.length ? INITIAL_NEED_WEIGHTS[index] : 0;
      weights[normalizedNeed] = bonus;
    });

    return weights;
  }

  // Tamano del pool segun el numero de pick global.
  function getCandidatePoolSize(draftEntry) {
    const overallPick = getOverallPickNumber(draftEntry);

    if (overallPick <= 32) {
      return CANDIDATE_POOL_EARLY;
    }

    if (overallPick <= 100) {
      return CANDIDATE_POOL_MID;
    }

    return CANDIDATE_POOL_LATE;
  }

  // Pool top N por ranking, excluyendo posiciones que superan el limite del equipo.
  function getCandidatePool(availablePlayers, teamState, draftEntry) {
    if (!Array.isArray(availablePlayers) || availablePlayers.length === 0) {
      return [];
    }

    const poolSize = getCandidatePoolSize(draftEntry);

    return availablePlayers
      .slice()
      .sort(function (a, b) {
        const rankA = getPlayerRank(a) || Number.MAX_SAFE_INTEGER;
        const rankB = getPlayerRank(b) || Number.MAX_SAFE_INTEGER;
        return rankA - rankB;
      })
      .filter(function (player) {
        return !hasReachedPositionLimit(teamState, player.position);
      })
      .slice(0, poolSize);
  }

  // Pool sin restricciones de posicion, usado como fallback.
  function getCandidatePoolUnrestricted(availablePlayers, draftEntry) {
    if (!Array.isArray(availablePlayers) || availablePlayers.length === 0) {
      return [];
    }

    const poolSize = getCandidatePoolSize(draftEntry);

    return availablePlayers
      .slice()
      .sort(function (a, b) {
        const rankA = getPlayerRank(a) || Number.MAX_SAFE_INTEGER;
        const rankB = getPlayerRank(b) || Number.MAX_SAFE_INTEGER;
        return rankA - rankB;
      })
      .slice(0, poolSize);
  }

  // Calcula el score de cada jugador del pool y devuelve array con scoreData.
  function scoreCandidates(candidatePool, teamState, draftEntry) {
    return candidatePool.map(function (player) {
      return {
        player: player,
        scoreData: scorePlayerForTeam(player, teamState, draftEntry, candidatePool)
      };
    });
  }

  // Score ponderado final: board + need + posValue + scarcity + random - reach - duplicate.
  function scorePlayerForTeam(player, teamState, draftEntry, candidatePool) {
    const playerRank = getPlayerRank(player);
    const boardScore = playerRank > 0 ? 1500 - playerRank : 0;
    const needScore = getNeedScore(player && player.position, teamState.needWeights);
    const positionalValueScore = getPositionalValueScore(player && player.position);
    const scarcityScore = getScarcityScore(player, candidatePool || []);
    const randomness = getRandomIntInclusive(RANDOMNESS_MIN, RANDOMNESS_MAX);
    const reachPenalty = getReachPenalty(playerRank, draftEntry);
    const duplicatePositionPenalty = getDuplicatePositionPenalty(
      player && player.position,
      teamState.draftedCountByPosition
    );
    const finalScore =
      boardScore + needScore + positionalValueScore + scarcityScore + randomness
      - reachPenalty - duplicatePositionPenalty;

    return {
      boardScore: boardScore,
      needScore: needScore,
      positionalValueScore: positionalValueScore,
      scarcityScore: scarcityScore,
      randomness: randomness,
      reachPenalty: reachPenalty,
      duplicatePositionPenalty: duplicatePositionPenalty,
      finalScore: finalScore
    };
  }

  // Devuelve la need del equipo que mejor casa con la posicion del jugador.
  function findMatchingNeed(playerPosition, needWeights) {
    if (!needWeights || typeof needWeights !== "object") {
      return null;
    }

    const normalizedPosition = normalizePositionCode(playerPosition);
    if (!normalizedPosition) {
      return null;
    }

    let bestNeed = null;
    let bestWeight = -1;

    Object.keys(needWeights).forEach(function (need) {
      if (matchesNeed(normalizedPosition, need) && needWeights[need] > bestWeight) {
        bestWeight = needWeights[need];
        bestNeed = need;
      }
    });

    return bestNeed;
  }

  // Bonus por needs dinamicas: devuelve el peso de la need que coincida.
  function getNeedScore(playerPosition, needWeights) {
    const matchedNeed = findMatchingNeed(playerPosition, needWeights);
    if (!matchedNeed) {
      return 0;
    }

    return needWeights[matchedNeed] || 0;
  }

  // Valor posicional fijo desde la tabla POSITION_VALUE_MAP.
  function getPositionalValueScore(playerPosition) {
    const normalizedPosition = normalizePositionCode(playerPosition);
    if (!normalizedPosition) {
      return 0;
    }

    return Object.prototype.hasOwnProperty.call(POSITION_VALUE_MAP, normalizedPosition)
      ? POSITION_VALUE_MAP[normalizedPosition]
      : 0;
  }

  // Penalizacion progresiva por draftear demasiadas veces la misma posicion.
  function getDuplicatePositionPenalty(playerPosition, draftedCountByPosition) {
    if (!draftedCountByPosition || typeof draftedCountByPosition !== "object") {
      return 0;
    }

    const normalizedPosition = normalizePositionCode(playerPosition);
    if (!normalizedPosition) {
      return 0;
    }

    const count = draftedCountByPosition[normalizedPosition] || 0;

    if (count <= 0) {
      return 0;
    }

    if (count < DUPLICATE_POSITION_PENALTIES.length) {
      return DUPLICATE_POSITION_PENALTIES[count];
    }

    return DUPLICATE_POSITION_PENALTIES[DUPLICATE_POSITION_PENALTIES.length - 1];
  }

  // Devuelve true si el equipo ya llego al maximo de jugadores para esa posicion.
  function hasReachedPositionLimit(teamState, playerPosition) {
    if (!teamState || !teamState.draftedCountByPosition) {
      return false;
    }

    const normalizedPosition = normalizePositionCode(playerPosition);
    if (!normalizedPosition) {
      return false;
    }

    if (!Object.prototype.hasOwnProperty.call(MAX_POSITION_COUNTS, normalizedPosition)) {
      return false;
    }

    const count = teamState.draftedCountByPosition[normalizedPosition] || 0;
    return count >= MAX_POSITION_COUNTS[normalizedPosition];
  }

  // Penaliza reaches: jugadores con rank mucho peor que el esperado para ese pick.
  function getReachPenalty(playerRank, draftEntry) {
    if (typeof playerRank !== "number" || Number.isNaN(playerRank) || playerRank <= 0) {
      return 0;
    }

    const overallPick = getOverallPickNumber(draftEntry);
    const expectedRank = overallPick + REACH_OFFSET;
    const delta = playerRank - expectedRank;

    if (delta <= 0) {
      return 0;
    }

    return delta * REACH_PENALTY_MULTIPLIER;
  }

  // Bonus de escasez: pocas opciones de esa posicion equivalente quedan disponibles.
  function getScarcityScore(player, candidatePool) {
    if (!player || !player.position || !Array.isArray(candidatePool)) {
      return 0;
    }

    const normalizedPosition = normalizePositionCode(player.position);
    if (!normalizedPosition) {
      return 0;
    }

    const playerRank = getPlayerRank(player);
    const rankCeiling = playerRank + SCARCITY_RANK_WINDOW;

    const countInWindow = candidatePool.filter(function (candidate) {
      if (normalizePositionCode(candidate.position) !== normalizedPosition) {
        return false;
      }

      const rank = getPlayerRank(candidate);
      return rank > 0 && rank <= rankCeiling;
    }).length;

    if (countInWindow <= SCARCITY_THRESHOLD_HIGH) {
      return SCARCITY_BONUS_HIGH;
    }

    if (countInWindow <= SCARCITY_THRESHOLD_LOW) {
      return SCARCITY_BONUS_LOW;
    }

    return 0;
  }

  function sortCandidatesByScore(candidates) {
    if (!Array.isArray(candidates)) {
      return [];
    }

    return candidates.slice().sort(function (a, b) {
      return b.scoreData.finalScore - a.scoreData.finalScore;
    });
  }

  // Devuelve los mejores FINALIST_COUNT candidatos.
  function getFinalists(sortedCandidates) {
    if (!Array.isArray(sortedCandidates)) {
      return [];
    }

    return sortedCandidates.slice(0, FINALIST_COUNT);
  }

  // Seleccion aleatoria ponderada entre los finalistas usando FINALIST_WEIGHTS.
  function pickWeightedRandom(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    const size = candidates.length;
    const selectedWeights = FINALIST_WEIGHTS.slice(0, size);
    const fallbackWeight = selectedWeights.length > 0 ? selectedWeights[selectedWeights.length - 1] : 1;

    while (selectedWeights.length < size) {
      selectedWeights.push(fallbackWeight);
    }

    const totalWeight = selectedWeights.reduce(function (sum, weight) {
      return sum + Math.max(0, weight);
    }, 0);

    if (totalWeight <= 0) {
      return candidates[getRandomIntInclusive(0, size - 1)];
    }

    let roll = Math.random() * totalWeight;
    for (let index = 0; index < size; index += 1) {
      roll -= Math.max(0, selectedWeights[index]);
      if (roll <= 0) {
        return candidates[index];
      }
    }

    return candidates[size - 1];
  }

  // Actualiza el teamState tras cada pick: contador de posicion y decaimiento de needWeights.
  function updateTeamStateAfterPick(teamCode, selectedPlayer) {
    const normalizedTeamCode = normalizeTeamCode(teamCode);
    const teamState = ensureTeamState(normalizedTeamCode);
    if (!teamState || !selectedPlayer) {
      return;
    }

    if (isPipelineEngineEnabled()) {
      app.autopickEngine.updateTeamStateAfterPick(teamState, selectedPlayer);
      return;
    }

    applyTeamStateUpdateLegacy(teamState, selectedPlayer);
  }

  function applyTeamStateUpdateLegacy(teamState, player) {
    const position = normalizePositionCode(player && player.position);
    if (!position) {
      return;
    }

    teamState.draftedCountByPosition[position] = (teamState.draftedCountByPosition[position] || 0) + 1;

    const matchedNeed = findMatchingNeed(position, teamState.needWeights);
    if (matchedNeed !== null) {
      teamState.needWeights[matchedNeed] = Math.max(0, teamState.needWeights[matchedNeed] * NEED_WEIGHT_DECAY);
    }
  }

  // Normalizacion de posiciones con reglas especiales OL/DB.
  function matchesNeed(playerPosition, need) {
    if (!playerPosition || !need) {
      return false;
    }

    const pos = normalizePositionCode(playerPosition);
    const n = normalizePositionCode(need);

    if (!pos || !n) {
      return false;
    }

    if (pos === n) {
      return true;
    }

    if (n === "OL" && (pos === "OT" || pos === "IOL")) {
      return true;
    }

    if (n === "DB" && (pos === "CB" || pos === "S")) {
      return true;
    }

    return false;
  }

  function getOverallPickNumber(draftEntry) {
    if (draftEntry && typeof draftEntry.pick === "number" && !Number.isNaN(draftEntry.pick) && draftEntry.pick > 0) {
      return draftEntry.pick;
    }

    if (app.state && typeof app.state.currentPickIndex === "number") {
      return app.state.currentPickIndex + 1;
    }

    return 1;
  }

  function getPlayerRank(player) {
    if (!player || typeof player.rank !== "number" || Number.isNaN(player.rank)) {
      return 0;
    }

    return player.rank;
  }

  function logAutoPickDebug(teamCode, draftEntry, finalists, selectedCandidate) {
    if (!Array.isArray(finalists) || finalists.length === 0) {
      return;
    }

    const overallPick = getOverallPickNumber(draftEntry);
    const pickLabel = "R" + (draftEntry && draftEntry.round ? draftEntry.round : "?") + " P" + overallPick;
    const expectedRank = overallPick + REACH_OFFSET;

    console.groupCollapsed(
      "[Autopick Debug] " + pickLabel + " - " + getTeamDisplayName(teamCode) + " | expectedRank=" + expectedRank
    );

    finalists.forEach(function (candidate, index) {
      const score = candidate.scoreData;
      console.log(
        "#" + (index + 1),
        {
          name: candidate.player.name,
          position: candidate.player.position,
          rank: candidate.player.rank,
          boardScore: score.boardScore,
          needScore: score.needScore,
          positionalValueScore: score.positionalValueScore,
          scarcityScore: score.scarcityScore,
          randomness: score.randomness,
          reachPenalty: score.reachPenalty,
          duplicatePositionPenalty: score.duplicatePositionPenalty,
          finalScore: score.finalScore
        }
      );
    });

    console.log("selected", {
      name: selectedCandidate.player.name,
      rank: selectedCandidate.player.rank,
      finalScore: selectedCandidate.scoreData.finalScore
    });
    console.groupEnd();
  }

  function normalizePositionCode(position) {
    if (typeof position !== "string") {
      return "";
    }

    return position.trim().toUpperCase();
  }

  function normalizeTeamCode(teamCode) {
    if (typeof teamCode !== "string") {
      return "";
    }

    return teamCode.trim().toUpperCase();
  }

  function getRandomIntInclusive(min, max) {
    const lower = Math.ceil(min);
    const upper = Math.floor(max);
    return Math.floor(Math.random() * (upper - lower + 1)) + lower;
  }

  function getAvailablePlayers() {
    const selectedSet = new Set(app.state.selectedPlayerNames);

    return app.data.players.filter(function (player) {
      return !selectedSet.has(player.name);
    });
  }

  // Seleccion manual del usuario cuando Miami esta on the clock.
  async function handleMiamiManualPick(playerName) {
    if (!ensureLoadedAndNotCompleted()) {
      return;
    }

    if (!isMiamiOnClock()) {
      setMessage("No puedes seleccionar jugadores manualmente cuando no le toca a Miami Dolphins.");
      renderAll();
      return;
    }

    const currentEntry = getCurrentDraftEntry();
    if (!currentEntry) {
      app.state.completed = true;
      persistState();
      renderAll();
      return;
    }

    const player = app.playersByName.get(playerName);
    if (!player) {
      showError("No se encontro el jugador seleccionado.");
      return;
    }

    if (app.state.selectedPlayerNames.includes(player.name)) {
      setMessage("Ese jugador ya fue seleccionado anteriormente.");
      renderAll();
      return;
    }

    applyPick(currentEntry, player, false);
    updateTeamStateAfterPick(normalizeTeamCode(currentEntry.team), player);
    persistState();
    setMessage("Miami Dolphins selecciono a " + player.name + " (" + player.position + ").");

    await runAutoUntilMiamiOrComplete();
    renderAll();
  }

  function applyPick(draftEntry, player, isAutoPick) {
    app.state.picks.push({
      round: draftEntry.round,
      pick: draftEntry.pick,
      team: draftEntry.team,
      player: {
        name: player.name,
        position: player.position,
        college: player.college,
        rank: player.rank
      },
      isAutoPick: Boolean(isAutoPick)
    });

    app.state.selectedPlayerNames.push(player.name);
    app.state.currentPickIndex += 1;

    if (app.state.currentPickIndex >= app.data.draftOrder.length) {
      app.state.completed = true;
    }
  }

  // Renderizado completo de UI.
  function renderAll() {
    if (!app.data || !app.state) {
      return;
    }

    clearError();
    renderHeader();
    renderLatestMiamiPickCard();
    renderCompletedPicks();
    renderAvailablePlayers();
    renderActionsState();
  }

  function renderLatestMiamiPickCard() {
    if (!app.state.started) {
      app.elements.miamiPickCard.hidden = true;
      clearLatestMiamiPickDisplay();
      return;
    }

    const latestMiamiPick = getLatestPickForTeam(USER_TEAM);

    if (!latestMiamiPick) {
      app.elements.miamiPickCard.hidden = true;
      clearLatestMiamiPickDisplay();
      return;
    }

    app.elements.miamiPickCard.hidden = false;
    app.elements.miamiPickSlot.textContent = "R" + latestMiamiPick.round + " Pick " + latestMiamiPick.pick;
    app.elements.miamiPickName.textContent = latestMiamiPick.player.name;
    app.elements.miamiPickMeta.textContent = latestMiamiPick.player.position + " | " + latestMiamiPick.player.college;
    app.elements.miamiPickRank.textContent = "#" + latestMiamiPick.player.rank;
  }

  function renderHeader() {
    const currentEntry = getCurrentDraftEntry();

    if (!app.state.started) {
      app.elements.currentRound.textContent = "-";
      app.elements.currentPick.textContent = "-";
      app.elements.currentTeam.textContent = "-";
      app.elements.draftStateLabel.textContent = "Pendiente de iniciar";
      app.elements.onClockIndicator.hidden = true;
      return;
    }

    if (!currentEntry) {
      app.elements.currentRound.textContent = "-";
      app.elements.currentPick.textContent = "-";
      app.elements.currentTeam.textContent = "-";
      app.elements.draftStateLabel.textContent = "Draft completado";
      app.elements.onClockIndicator.hidden = true;
      return;
    }

    app.elements.currentRound.textContent = String(currentEntry.round);
    app.elements.currentPick.textContent = String(currentEntry.pick);
    app.elements.currentTeam.textContent = getTeamDisplayName(currentEntry.team);

    if (isMiamiOnClock()) {
      app.elements.draftStateLabel.textContent = "Turno de Miami Dolphins";
      app.elements.onClockIndicator.hidden = false;
    } else {
      app.elements.draftStateLabel.textContent = "Avance automatico";
      app.elements.onClockIndicator.hidden = true;
    }
  }

  function renderCompletedPicks() {
    const list = app.elements.completedPicksList;
    list.innerHTML = "";

    const filteredPicks = getFilteredCompletedPicks();
    const latestVisiblePickKey = getLatestVisiblePickKey(filteredPicks);
    let latestVisiblePickElement = null;

    if (filteredPicks.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = app.state.picks.length === 0
        ? "Todavia no hay picks realizados."
        : "No hay picks para el equipo seleccionado.";
      list.appendChild(empty);
      app.ui.lastRenderedLatestPickKey = "";
      return;
    }

    filteredPicks.forEach(function (entry) {
      const item = document.createElement("li");
      const entryPickKey = getPickKey(entry);
      const isLatestVisiblePick = entryPickKey === latestVisiblePickKey;

      item.className = "pick-item" +
        (normalizeTeamCode(entry.team) === USER_TEAM ? " pick-item--miami" : "") +
        (isLatestVisiblePick ? " pick-item--latest" : "");

      item.innerHTML =
        "<strong>R" + entry.round + " P" + entry.pick + "</strong>" +
        "<span class=\"pick-team\">" + getTeamDisplayName(entry.team) + "</span>" +
        "<span>" + entry.player.name + " (" + entry.player.position + ")</span>" +
        "<small>" + entry.player.college + " | Rank " + entry.player.rank + "</small>";

      list.appendChild(item);

      if (isLatestVisiblePick) {
        latestVisiblePickElement = item;
      }
    });

    renderCompletedPicksFilterState();

    if (latestVisiblePickKey && latestVisiblePickElement) {
      const shouldRevealLatestPick =
        latestVisiblePickKey !== app.ui.lastRenderedLatestPickKey ||
        !isElementFullyVisibleInContainer(list, latestVisiblePickElement);

      if (shouldRevealLatestPick) {
        revealElementInContainer(list, latestVisiblePickElement);
      }
    }

    app.ui.lastRenderedLatestPickKey = latestVisiblePickKey;
  }

  function renderAvailablePlayers() {
    const list = app.elements.availablePlayersList;
    list.innerHTML = "";

    const players = getFilteredAvailablePlayers();

    if (players.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "No hay jugadores que coincidan con los filtros.";
      list.appendChild(empty);
      return;
    }

    const manualSelectionAllowed = isMiamiOnClock() && !app.state.completed;

    players.forEach(function (player) {
      const item = document.createElement("li");
      item.className = "player-item";

      const actionButton = manualSelectionAllowed
        ? "<button type=\"button\" data-player-name=\"" + escapeHtmlAttr(player.name) + "\">Seleccionar</button>"
        : "<span class=\"disabled-action\">Disponible para CPU</span>";

      item.innerHTML =
        "<div class=\"player-main\">" +
        "<strong>" + player.name + "</strong>" +
        "<span>" + player.position + " | " + player.college + "</span>" +
        "</div>" +
        "<div class=\"player-side\">" +
        "<span class=\"player-rank\">Rank " + player.rank + "</span>" +
        actionButton +
        "</div>";

      list.appendChild(item);
    });
  }

  function getFilteredAvailablePlayers() {
    const players = getAvailablePlayers();

    return players
      .filter(function (player) {
        if (app.ui.positionFilter !== "ALL" && normalizePositionCode(player.position) !== app.ui.positionFilter) {
          return false;
        }

        if (app.ui.searchTerm && player.name.toLowerCase().indexOf(app.ui.searchTerm) === -1) {
          return false;
        }

        return true;
      })
      .sort(function (a, b) {
        return a.rank - b.rank;
      });
  }

  function populatePositionFilter(players) {
    const select = app.elements.positionFilter;
    const positionSet = new Set();

    players.forEach(function (player) {
      const position = normalizePositionCode(player.position);
      if (position) {
        positionSet.add(position);
      }
    });

    const sortedPositions = Array.from(positionSet).sort();

    sortedPositions.forEach(function (position) {
      const option = document.createElement("option");
      option.value = position;
      option.textContent = position;
      select.appendChild(option);
    });
  }

  function populateCompletedPicksTeamFilter(draftOrder) {
    const select = app.elements.completedPicksTeamFilter;
    const teams = new Set();

    draftOrder.forEach(function (entry) {
      teams.add(normalizeTeamCode(entry.team));
    });

    Array.from(teams)
      .sort(function (teamA, teamB) {
        return getTeamDisplayName(teamA).localeCompare(getTeamDisplayName(teamB), "es");
      })
      .forEach(function (teamCode) {
        const option = document.createElement("option");
        option.value = teamCode;
        option.textContent = getTeamDisplayName(teamCode);
        select.appendChild(option);
      });
  }

  function getFilteredCompletedPicks() {
    if (app.ui.picksTeamFilter === "ALL") {
      return app.state.picks;
    }

    return app.state.picks.filter(function (entry) {
      return normalizeTeamCode(entry.team) === app.ui.picksTeamFilter;
    });
  }

  function getLatestVisiblePickKey(filteredPicks) {
    if (!Array.isArray(filteredPicks) || filteredPicks.length === 0) {
      return "";
    }

    return getPickKey(filteredPicks[filteredPicks.length - 1]);
  }

  function getPickKey(entry) {
    if (!entry) {
      return "";
    }

    return [entry.round, entry.pick, normalizeTeamCode(entry.team), entry.player && entry.player.name].join("|");
  }

  function isElementFullyVisibleInContainer(container, element) {
    if (!container || !element) {
      return false;
    }

    const visibilityMargin = 14;
    const elementTop = element.offsetTop;
    const elementBottom = elementTop + element.offsetHeight;
    const visibleTop = container.scrollTop + visibilityMargin;
    const visibleBottom = container.scrollTop + container.clientHeight - visibilityMargin;

    return elementTop >= visibleTop && elementBottom <= visibleBottom;
  }

  function revealElementInContainer(container, element) {
    if (!container || !element) {
      return;
    }

    const visibilityMargin = 14;
    const elementTop = element.offsetTop;
    const elementBottom = elementTop + element.offsetHeight;
    const visibleTop = container.scrollTop;
    const visibleBottom = container.scrollTop + container.clientHeight;

    let nextScrollTop = container.scrollTop;

    if (elementTop < visibleTop + visibilityMargin) {
      nextScrollTop = Math.max(0, elementTop - visibilityMargin);
    } else if (elementBottom > visibleBottom - visibilityMargin) {
      nextScrollTop = Math.max(0, elementBottom - container.clientHeight + visibilityMargin);
    }

    container.scrollTo({
      top: nextScrollTop,
      behavior: "smooth"
    });
  }

  function getLatestPickForTeam(teamCode) {
    const normalizedTeamCode = normalizeTeamCode(teamCode);

    for (let index = app.state.picks.length - 1; index >= 0; index -= 1) {
      if (normalizeTeamCode(app.state.picks[index].team) === normalizedTeamCode) {
        return app.state.picks[index];
      }
    }

    return null;
  }

  function setCompletedPicksTeamFilter(teamCode) {
    app.ui.picksTeamFilter = teamCode;
    app.elements.completedPicksTeamFilter.value = teamCode;
    renderCompletedPicks();
  }

  function renderCompletedPicksFilterState() {
    const isShowingAll = app.ui.picksTeamFilter === "ALL";

    app.elements.btnPicksFilterAll.classList.toggle("is-active", isShowingAll);
    app.elements.btnPicksFilterMiami.classList.toggle("is-active", app.ui.picksTeamFilter === USER_TEAM);
  }

  function renderActionsState() {
    const completed = app.state.completed;
    const started = Boolean(app.state.started);
    const miamiOnClock = isMiamiOnClock();
    const autoRunActive = app.autoRun.active;
    const hasPicks = Array.isArray(app.state.picks) && app.state.picks.length > 0;

    app.elements.btnStartDraft.disabled = started || completed || autoRunActive;
    app.elements.btnSimNextMiami.disabled = !started || completed || autoRunActive;
    app.elements.btnContinue.disabled = !started || completed || autoRunActive;
    app.elements.btnExportCsv.disabled = !hasPicks;
    app.elements.btnImportCsv.disabled = autoRunActive;
    app.elements.autoPickSpeed.disabled = autoRunActive;

    if (!started && !completed) {
      app.elements.btnStartDraft.textContent = "Iniciar draft";
      app.elements.btnContinue.textContent = "Continuar draft";
    } else if (autoRunActive) {
      app.elements.btnStartDraft.textContent = "Draft iniciado";
      app.elements.btnContinue.textContent = "Autopick en curso...";
    } else if (miamiOnClock && !completed) {
      app.elements.btnStartDraft.textContent = "Draft iniciado";
      app.elements.btnContinue.textContent = "Continuar draft (esperando pick de Miami)";
    } else {
      app.elements.btnStartDraft.textContent = started ? "Draft iniciado" : "Iniciar draft";
      app.elements.btnContinue.textContent = "Continuar draft";
    }
  }

  function setMessage(message) {
    app.elements.draftMessage.textContent = message;
  }

  function showError(message) {
    app.elements.draftError.hidden = false;
    app.elements.draftError.textContent = message;
    app.elements.draftStateLabel.textContent = "Error";
  }

  function clearError() {
    app.elements.draftError.hidden = true;
    app.elements.draftError.textContent = "";
  }

  function getTeamDisplayName(teamCode) {
    const normalized = normalizeTeamCode(teamCode);
    return TEAM_DISPLAY_NAMES[normalized] || normalized;
  }

  function beginAutoRun() {
    app.autoRun.token += 1;
    app.autoRun.active = true;
    renderActionsState();
    return app.autoRun.token;
  }

  function finishAutoRun(token) {
    if (!isAutoRunTokenActive(token)) {
      return;
    }

    app.autoRun.active = false;
    renderActionsState();
  }

  function cancelAutoRun() {
    app.autoRun.token += 1;
    app.autoRun.active = false;
    renderActionsState();
  }

  function isAutoRunTokenActive(token) {
    return app.autoRun.active && app.autoRun.token === token;
  }

  function waitForAutoPickDelay(token) {
    return new Promise(function (resolve) {
      window.setTimeout(function () {
        resolve(isAutoRunTokenActive(token));
      }, getCurrentAutoPickDelayMs());
    });
  }

  function getCurrentAutoPickDelayMs() {
    const currentSpeed = AUTO_PICK_SPEEDS[app.ui.autoPickSpeed] || AUTO_PICK_SPEEDS[DEFAULT_AUTO_PICK_SPEED];
    return currentSpeed.delayMs;
  }

  function getCurrentAutoPickSpeedLabel() {
    const currentSpeed = AUTO_PICK_SPEEDS[app.ui.autoPickSpeed] || AUTO_PICK_SPEEDS[DEFAULT_AUTO_PICK_SPEED];
    return currentSpeed.label;
  }

  function normalizeAutoPickSpeed(value) {
    return Object.prototype.hasOwnProperty.call(AUTO_PICK_SPEEDS, value)
      ? value
      : DEFAULT_AUTO_PICK_SPEED;
  }

  function syncAutoPickSpeedControl() {
    if (!app.elements.autoPickSpeed) {
      return;
    }

    app.elements.autoPickSpeed.value = normalizeAutoPickSpeed(app.ui.autoPickSpeed);
  }

  function clearLatestMiamiPickDisplay() {
    app.elements.miamiPickSlot.textContent = "-";
    app.elements.miamiPickName.textContent = "-";
    app.elements.miamiPickMeta.textContent = "-";
    app.elements.miamiPickRank.textContent = "-";
  }

  function exportMockDraftToCsv() {
    if (!app.state || !Array.isArray(app.state.picks) || app.state.picks.length === 0) {
      setMessage("No hay picks para exportar todavia.");
      return;
    }

    const headers = ["Ronda", "pick", "equipo", "jugador", "posición", "college"];
    const rows = [headers].concat(
      app.state.picks.map(function (entry) {
        return [
          entry.round,
          entry.pick,
          getTeamDisplayName(entry.team),
          entry.player.name,
          entry.player.position,
          entry.player.college
        ];
      })
    );

    const csv = rows.map(function (row) {
      return row.map(escapeCsvField).join(",");
    }).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    link.href = url;
    link.download = "mock-draft-" + timestamp + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setMessage("Mock draft exportado a CSV.");
  }

  async function importMockDraftFromCsvFile(file) {
    if (!app.data || !app.state) {
      showError("El simulador aun no esta listo para importar.");
      return;
    }

    cancelAutoRun();

    try {
      const csvText = await readFileAsText(file);
      const importedPicks = parseMockDraftCsv(csvText);

      if (importedPicks.length === 0) {
        showError("El CSV no contiene picks para importar.");
        return;
      }

      applyImportedMockDraft(importedPicks);
      persistState();
      renderAll();
      setMessage("Mock draft importado: " + importedPicks.length + " picks cargados.");
    } catch (error) {
      showError(error && error.message ? error.message : "No se pudo importar el CSV.");
    }
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();

      reader.onerror = function () {
        reject(new Error("No se pudo leer el archivo CSV seleccionado."));
      };

      reader.onload = function () {
        resolve(String(reader.result || ""));
      };

      reader.readAsText(file, "utf-8");
    });
  }

  function parseMockDraftCsv(csvText) {
    const rows = parseCsvRows(csvText || "");

    if (rows.length <= 1) {
      return [];
    }

    const header = rows[0].map(normalizeHeaderName);
    const required = ["ronda", "pick", "equipo", "jugador", "posicion", "college"];

    const missingHeader = required.some(function (name) {
      return header.indexOf(name) === -1;
    });

    if (missingHeader) {
      throw new Error("El CSV no tiene el formato esperado de exportacion.");
    }

    const headerIndex = {
      round: header.indexOf("ronda"),
      pick: header.indexOf("pick"),
      team: header.indexOf("equipo"),
      playerName: header.indexOf("jugador"),
      position: header.indexOf("posicion"),
      college: header.indexOf("college")
    };

    const imported = [];

    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row || row.every(function (value) { return !String(value || "").trim(); })) {
        continue;
      }

      const round = parseInt(String(row[headerIndex.round] || "").trim(), 10);
      const pick = parseInt(String(row[headerIndex.pick] || "").trim(), 10);
      const teamCode = getTeamCodeFromCsvValue(row[headerIndex.team]);
      const playerName = String(row[headerIndex.playerName] || "").trim();
      const csvPosition = normalizePositionCode(row[headerIndex.position]);
      const csvCollege = String(row[headerIndex.college] || "").trim();

      if (!round || !pick || !teamCode || !playerName) {
        throw new Error("El CSV contiene filas invalidas. Revisa ronda, pick, equipo y jugador.");
      }

      const playerFromBoard = app.playersByName.get(playerName);
      const playerPosition = playerFromBoard ? playerFromBoard.position : csvPosition;
      const playerCollege = playerFromBoard ? playerFromBoard.college : csvCollege;
      const playerRank = playerFromBoard && typeof playerFromBoard.rank === "number"
        ? playerFromBoard.rank
        : findPlayerRankByName(playerName);

      if (!playerPosition) {
        throw new Error("No se pudo determinar la posicion de: " + playerName + ".");
      }

      imported.push({
        round: round,
        pick: pick,
        team: teamCode,
        player: {
          name: playerName,
          position: playerPosition,
          college: playerCollege || "N/A",
          rank: playerRank
        },
        isAutoPick: teamCode !== USER_TEAM
      });
    }

    imported.sort(function (a, b) {
      if (a.round !== b.round) {
        return a.round - b.round;
      }

      return a.pick - b.pick;
    });

    validateImportedPicks(imported);
    return imported;
  }

  function validateImportedPicks(importedPicks) {
    const draftOrderBySlot = new Map(
      app.data.draftOrder.map(function (entry) {
        return [entry.round + "|" + entry.pick, normalizeTeamCode(entry.team)];
      })
    );

    const seenPlayers = new Set();

    importedPicks.forEach(function (entry) {
      const slotKey = entry.round + "|" + entry.pick;
      const expectedTeam = draftOrderBySlot.get(slotKey);

      if (!expectedTeam) {
        throw new Error("El CSV contiene picks fuera del orden oficial del draft.");
      }

      if (expectedTeam !== normalizeTeamCode(entry.team)) {
        throw new Error("El CSV no coincide con el orden de equipos para R" + entry.round + " P" + entry.pick + ".");
      }

      const normalizedPlayerName = entry.player.name.toLowerCase();
      if (seenPlayers.has(normalizedPlayerName)) {
        throw new Error("El CSV contiene jugadores duplicados: " + entry.player.name + ".");
      }

      seenPlayers.add(normalizedPlayerName);
    });

    for (let index = 0; index < importedPicks.length; index += 1) {
      const imported = importedPicks[index];
      const expected = app.data.draftOrder[index];

      if (!expected) {
        throw new Error("El CSV tiene mas picks que el draft configurado.");
      }

      const expectedTeam = normalizeTeamCode(expected.team);
      const expectedRound = expected.round;
      const expectedPick = expected.pick;

      if (
        imported.round !== expectedRound ||
        imported.pick !== expectedPick ||
        normalizeTeamCode(imported.team) !== expectedTeam
      ) {
        throw new Error("El CSV debe contener picks consecutivos desde el inicio del draft.");
      }
    }
  }

  function applyImportedMockDraft(importedPicks) {
    resetTeamStates();
    app.state = createInitialState();
    app.state.started = true;
    app.state.picks = importedPicks;
    app.state.selectedPlayerNames = importedPicks.map(function (entry) {
      return entry.player.name;
    });
    app.state.pickExplanations = [];
    app.state.currentPickIndex = importedPicks.length;
    app.state.completed = app.state.currentPickIndex >= app.data.draftOrder.length;
    app.ui.lastRenderedLatestPickKey = "";

    rebuildTeamStatesFromPicks(importedPicks);
  }

  function parseCsvRows(csvText) {
    const rows = [];
    let currentField = "";
    let currentRow = [];
    let insideQuotes = false;

    for (let index = 0; index < csvText.length; index += 1) {
      const char = csvText[index];
      const nextChar = csvText[index + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          currentField += '"';
          index += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }

      if (!insideQuotes && char === ",") {
        currentRow.push(currentField);
        currentField = "";
        continue;
      }

      if (!insideQuotes && (char === "\n" || char === "\r")) {
        if (char === "\r" && nextChar === "\n") {
          index += 1;
        }

        currentRow.push(currentField);
        rows.push(currentRow);
        currentField = "";
        currentRow = [];
        continue;
      }

      currentField += char;
    }

    currentRow.push(currentField);
    rows.push(currentRow);

    return rows;
  }

  function normalizeHeaderName(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    return normalized;
  }

  function getTeamCodeFromCsvValue(value) {
    const raw = String(value || "").trim();
    const normalizedRaw = normalizeTeamCode(raw);

    if (TEAM_DISPLAY_NAMES[normalizedRaw]) {
      return normalizedRaw;
    }

    const normalizedName = raw.toLowerCase();
    const foundCode = Object.keys(TEAM_DISPLAY_NAMES).find(function (teamCode) {
      return TEAM_DISPLAY_NAMES[teamCode].toLowerCase() === normalizedName;
    });

    return foundCode || "";
  }

  function findPlayerRankByName(name) {
    const normalized = String(name || "").trim().toLowerCase();
    const player = app.data.players.find(function (entry) {
      return String(entry.name || "").trim().toLowerCase() === normalized;
    });

    return player && typeof player.rank === "number" ? player.rank : 999;
  }

  function escapeCsvField(value) {
    const text = String(value == null ? "" : value);
    return /[",\n]/.test(text)
      ? "\"" + text.replace(/\"/g, "\"\"") + "\""
      : text;
  }

  function escapeHtmlAttr(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/\"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
