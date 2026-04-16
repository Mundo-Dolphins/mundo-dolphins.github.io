(function () {
  "use strict";

  // Configuracion principal y parametros de scoring del autopick.
  const STORAGE_KEY = "draftSimulator.current";
  const STATE_VERSION = 1;
  const USER_TEAM = "MIA";

  const NEED_BONUSES = [60, 40, 25, 15, 8];
  const AUTOPICK_RANDOM_MIN = 0;
  const AUTOPICK_RANDOM_MAX = 15;

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
    needsMap: {},
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
      app.needsMap = buildNeedsMap(app.data.teamNeeds);
      app.playersByName = buildPlayersByName(app.data.players);
      populatePositionFilter(app.data.players);
        populateCompletedPicksTeamFilter(app.data.draftOrder);

      const savedState = loadStateFromStorage();
      if (savedState) {
        app.state = savedState;
        app.ui.autoPickSpeed = normalizeAutoPickSpeed(savedState.autoPickSpeed);
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

    app.elements.btnReset.addEventListener("click", async function () {
      if (!app.data) {
        return;
      }

      cancelAutoRun();
      app.state = createInitialState();
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

      app.state = createInitialState();
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

  function buildNeedsMap(teamNeeds) {
    const map = {};

    teamNeeds.forEach(function (entry) {
      const teamCode = normalizeTeamCode(entry.team);
      map[teamCode] = (entry.needs || []).slice(0, NEED_BONUSES.length).map(normalizePositionCode);
    });

    return map;
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
      selectedPlayerNames: []
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
      selectedPlayerNames: parsed.selectedPlayerNames
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

    const selected = selectAutoPick(teamCode, availablePlayers);

    applyPick(currentEntry, selected.player, true);
    setMessage(getTeamDisplayName(currentEntry.team) + " seleccionan a " + selected.player.name + " (" + selected.player.position + ").");

    return {
      draftEntry: currentEntry,
      player: selected.player
    };
  }

  // Scoring y seleccion de mejor jugador disponible para un equipo CPU.
  function selectAutoPick(teamCode, availablePlayers) {
    const needs = app.needsMap[teamCode] || [];

    let best = null;

    availablePlayers.forEach(function (player) {
      const scoreData = scorePlayerForTeam(player, needs);
      if (!best || scoreData.finalScore > best.finalScore) {
        best = {
          player: player,
          finalScore: scoreData.finalScore
        };
      }
    });

    return best;
  }

  function scorePlayerForTeam(player, teamNeeds) {
    const baseScore = getBaseScore(player);
    const needBonus = getNeedBonus(teamNeeds, player.position);
    const randomness = getRandomIntInclusive(AUTOPICK_RANDOM_MIN, AUTOPICK_RANDOM_MAX);
    const finalScore = baseScore + needBonus + randomness;

    return {
      baseScore: baseScore,
      needBonus: needBonus,
      randomness: randomness,
      finalScore: finalScore
    };
  }

  function getBaseScore(player) {
    if (!player || typeof player.rank !== "number" || Number.isNaN(player.rank)) {
      return 0;
    }

    return 1000 - player.rank;
  }

  function getNeedBonus(teamNeeds, playerPosition) {
    if (!Array.isArray(teamNeeds) || teamNeeds.length === 0) {
      return 0;
    }

    if (!isValidPosition(playerPosition)) {
      return 0;
    }

    for (let index = 0; index < teamNeeds.length && index < NEED_BONUSES.length; index += 1) {
      const need = teamNeeds[index];
      if (matchesNeed(playerPosition, need)) {
        return NEED_BONUSES[index];
      }
    }

    return 0;
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

  function isValidPosition(position) {
    return Boolean(normalizePositionCode(position));
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
      return;
    }

    const latestMiamiPick = getLatestPickForTeam(USER_TEAM);

    if (!latestMiamiPick) {
      app.elements.miamiPickCard.hidden = true;
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

    app.elements.btnStartDraft.disabled = started || completed || autoRunActive;
    app.elements.btnSimNextMiami.disabled = !started || completed || autoRunActive;
    app.elements.btnContinue.disabled = !started || completed || autoRunActive;
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

  function escapeHtmlAttr(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/\"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
