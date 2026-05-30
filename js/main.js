/* Wires the HUD, settings panel, and winner banner to the race engine. */
(async () => {
  const $ = (id) => document.getElementById(id);
  const canvas = $("arena");

  const timerEl = $("timer");
  const startBtn = $("startBtn");
  const pauseBtn = $("pauseBtn");
  const shuffleBtn = $("shuffleBtn");
  const clearBtn = $("clearBtn");
  const settingsBtn = $("settingsBtn");

  const settingsPanel = $("settingsPanel");
  const countSlider = $("countSlider");
  const countLabel = $("countLabel");
  const showNumbers = $("showNumbers");
  const useArt = $("useArt");
  const chaosSlider = $("chaosSlider");
  const durationSel = $("durationSel");

  const winnerBanner = $("winnerBanner");
  const winnerText = $("winnerText");
  const winnerSprite = $("winnerSprite");
  const removeWinner = $("removeWinner");

  await KaijuArt.loadSprites();

  const race = new KaijuRace(canvas, (num) => {
    winnerText.textContent = `Kaiju #${num} wins!`;
    const wr = race.winnerRacer;
    if (wr && wr.sprite) {
      winnerSprite.src = wr.sprite.toDataURL();
      winnerSprite.hidden = false;
    } else {
      winnerSprite.hidden = true;
    }
    winnerBanner.hidden = false;
    syncButtons();
  });

  function fmt(sec) {
    const s = Math.floor(sec) % 60;
    const m = Math.floor(sec / 60) % 60;
    const h = Math.floor(sec / 3600);
    const p = (x) => String(x).padStart(2, "0");
    return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`; // MM:SS under an hour
  }

  function tickTimer() {
    const D = race.cfg.duration;
    const remaining = race.state === "idle" ? D : Math.max(0, D - race.elapsed);
    timerEl.textContent = fmt(Math.ceil(remaining));
    requestAnimationFrame(tickTimer);
  }
  tickTimer();

  function syncButtons() {
    const running = race.state === "running";
    startBtn.hidden = running;
    pauseBtn.hidden = !running;
    startBtn.textContent = race.state === "paused" ? "Resume" : "Start";
  }

  function applyConfig() {
    race.configure({
      count: +countSlider.value,
      showNumbers: showNumbers.checked,
      useArt: useArt.checked,
      chaos: +chaosSlider.value,
      duration: +durationSel.value,
    });
  }

  // ---- HUD buttons ----
  startBtn.onclick = () => {
    winnerBanner.hidden = true;
    if (race.state === "paused") race.resume();
    else race.start();
    syncButtons();
  };
  pauseBtn.onclick = () => { race.pause(); syncButtons(); };
  shuffleBtn.onclick = () => { winnerBanner.hidden = true; race.shuffle(); syncButtons(); };
  clearBtn.onclick = () => {
    winnerBanner.hidden = true;
    race.exclude.clear();
    race.clear();
    syncButtons();
  };

  // ---- Settings ----
  settingsBtn.onclick = () => { settingsPanel.hidden = !settingsPanel.hidden; };
  $("closeSettings").onclick = () => { settingsPanel.hidden = true; };
  countSlider.oninput = () => { countLabel.textContent = countSlider.value; };
  $("applySettings").onclick = () => {
    applyConfig();
    race.exclude.clear();
    race.clear();
    settingsPanel.hidden = true;
    winnerBanner.hidden = true;
    syncButtons();
  };
  useArt.disabled = !KaijuArt.hasSprites();
  if (!KaijuArt.hasSprites()) {
    useArt.parentElement.title = "No generated art found yet — drop PNGs in /sprites and add manifest.json";
  }

  // ---- Winner banner ----
  $("closeWinner").onclick = () => { winnerBanner.hidden = true; };
  $("raceAgainBtn").onclick = () => {
    if (removeWinner.checked && race.winner != null) race.exclude.add(race.winner);
    winnerBanner.hidden = true;
    race.reset();
    race.start();
    syncButtons();
  };

  // Init
  applyConfig();
  race.reset();
  syncButtons();
})();
