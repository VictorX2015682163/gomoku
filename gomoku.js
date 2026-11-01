(() => {
  // ============================================================
  // 常量
  // ============================================================
  const SIZE = 15;
  const PADDING = 30;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const STEP = (W - PADDING * 2) / (SIZE - 1);  // 格子间距

  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const SAVE_KEY = "charlie-gomoku-save";

  // ============================================================
  // 状态
  // ============================================================
  const state = {
    board: null,            // 15x15 二维数组
    history: [],            // [{r, c, player}]
    mode: null,             // "pvp" | "pve"
    turn: BLACK,            // 当前轮到谁
    over: false,
    winner: 0,              // 0=未结束, 1=黑, 2=白, 3=和
    winLine: null,          // {r1,c1,r2,c2} 胜利的 5 子线
    hover: null,            // {r, c} 鼠标悬停的位置
    aiThinking: false,
  };
  let aiTimer = null;

  function newBoard() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
  }

  // ============================================================
  // 存档
  // ============================================================
  function saveGame() {
    if (state.over || !state.mode) {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
      return;
    }
    try {
      const data = {
        v: 1,
        mode: state.mode,
        history: state.history,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1) return null;
      if (!Array.isArray(d.history)) return null;
      if (d.mode !== "pvp" && d.mode !== "pve") return null;
      return d;
    } catch (e) { return null; }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  function cancelAIMove() {
    if (aiTimer !== null) {
      clearTimeout(aiTimer);
      aiTimer = null;
    }
    state.aiThinking = false;
  }

  // ============================================================
  // 模式选择
  // ============================================================
  function showModePicker(canResume) {
    state.over = true;         // 选择期间禁用棋盘点击
    const overlay = document.getElementById("overlay");
    const card = document.getElementById("overlayCard");
    card.classList.remove("lose", "draw");
    document.getElementById("overlayTitle").innerHTML = "🎯 五子棋";
    document.getElementById("overlayMsg").textContent = "选择对战模式";
    document.getElementById("overlayContent").innerHTML = `
      <div class="mode-grid">
        <div class="mode-card" data-mode="pvp">
          <span class="emoji">👥</span>
          <div class="name">双人对战</div>
          <div class="desc">同台轮流落子<br>和朋友面对面玩</div>
        </div>
        <div class="mode-card" data-mode="pve">
          <span class="emoji">🤖</span>
          <div class="name">人机对战</div>
          <div class="desc">你执黑先手<br>挑战 AI</div>
        </div>
      </div>
      ${canResume ? '<button id="resumeBtn" class="secondary">继续上次</button>' : ''}
    `;
    overlay.classList.remove("hidden");
    overlay.querySelectorAll(".mode-card").forEach(el => {
      el.addEventListener("click", () => {
        startGame(el.dataset.mode);
        overlay.classList.add("hidden");
      });
    });
    const rb = document.getElementById("resumeBtn");
    if (rb) rb.addEventListener("click", () => {
      const d = loadGame();
      if (!d) return;
      resumeFrom(d);
      overlay.classList.add("hidden");
    });
  }

  // ============================================================
  // 启动 / 重开 / 续存档
  // ============================================================
  function startGame(mode) {
    cancelAIMove();
    state.board = newBoard();
    state.history = [];
    state.mode = mode;
    state.turn = BLACK;
    state.over = false;
    state.winner = 0;
    state.winLine = null;
    state.hover = null;
    updateHud();
    saveGame();
  }

  function resumeFrom(data) {
    cancelAIMove();
    state.board = newBoard();
    state.history = [];
    state.mode = data.mode;
    state.turn = BLACK;
    state.over = false;
    state.winner = 0;
    state.winLine = null;
    state.hover = null;
    // 重放历史
    for (const m of data.history) {
      if (typeof m.r === "number" && typeof m.c === "number" &&
          state.board[m.r] && state.board[m.r][m.c] === EMPTY &&
          (m.player === BLACK || m.player === WHITE)) {
        state.board[m.r][m.c] = m.player;
        state.history.push({ r: m.r, c: m.c, player: m.player });
        state.turn = m.player === BLACK ? WHITE : BLACK;
      }
    }
    updateHud();
    // 如果加载完轮到 AI，让它走
    if (state.mode === "pve" && state.turn === WHITE) {
      scheduleAIMove();
    }
  }

  // ============================================================
  // HUD
  // ============================================================
  const hud = {
    mode: document.getElementById("hudMode"),
    turn: document.getElementById("hudTurn"),
    turnDot: document.getElementById("hudTurnDot"),
    step: document.getElementById("hudStep"),
  };
  function updateHud() {
    hud.mode.textContent = state.mode === "pvp" ? "双人" : state.mode === "pve" ? "人机" : "—";
    const isBlack = state.turn === BLACK;
    hud.turn.textContent = state.over
      ? "已结束"
      : state.mode === "pve" && state.turn === WHITE ? "AI 思考"
      : isBlack ? "黑棋" : "白棋";
    hud.turnDot.className = "turn-dot " + (isBlack ? "black" : "white");
    hud.step.textContent = state.history.length;
    document.getElementById("undoBtn").disabled = state.history.length === 0 || state.over || state.aiThinking;
  }

  // ============================================================
  // 落子
  // ============================================================
  function place(r, c, player) {
    if (state.over) return false;
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;
    if (state.board[r][c] !== EMPTY) return false;
    state.board[r][c] = player;
    state.history.push({ r, c, player });
    const win = checkWin(r, c, player);
    if (win) {
      state.over = true;
      state.winner = player;
      state.winLine = win;
      clearSave();
      setTimeout(showResult, 300);  // 让玩家看到子落下后再弹
    } else if (state.history.length === SIZE * SIZE) {
      state.over = true;
      state.winner = 3;
      clearSave();
      setTimeout(showResult, 300);
    } else {
      state.turn = player === BLACK ? WHITE : BLACK;
      saveGame();
    }
    updateHud();
    return true;
  }

  function showResult() {
    const overlay = document.getElementById("overlay");
    const card = document.getElementById("overlayCard");
    card.classList.remove("lose", "draw");
    let title, msg, klass = "";
    if (state.winner === 3) {
      title = "🤝 和棋"; msg = "棋盘下满了"; klass = "draw";
    } else if (state.mode === "pve") {
      if (state.winner === BLACK) { title = "🎉 你赢了！"; msg = "战胜了 AI"; }
      else { title = "💔 AI 赢了"; msg = "再来一局？"; klass = "lose"; }
    } else {
      title = state.winner === BLACK ? "⚫ 黑棋胜" : "⚪ 白棋胜";
      msg = "再来一局？";
    }
    if (klass) card.classList.add(klass);
    document.getElementById("overlayTitle").textContent = title;
    document.getElementById("overlayMsg").textContent = msg;
    document.getElementById("overlayContent").innerHTML = `
      <button id="againBtn">再来一局</button>
      <button class="secondary" id="changeModeBtn">换模式</button>
    `;
    overlay.classList.remove("hidden");
    document.getElementById("againBtn").addEventListener("click", () => {
      startGame(state.mode);
      overlay.classList.add("hidden");
    });
    document.getElementById("changeModeBtn").addEventListener("click", () => {
      showModePicker(false);
    });
  }

  // ============================================================
  // 胜负检测
  // ============================================================
  // 在 (r,c) 落子的玩家是 player，检查是否 5 子连
  function checkWin(r, c, player) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      let count = 1;
      let r1 = r, c1 = c, r2 = r, c2 = c;
      // 正向
      let rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && state.board[rr][cc] === player) {
        count++;
        r2 = rr; c2 = cc;
        rr += dr; cc += dc;
      }
      // 反向
      rr = r - dr; cc = c - dc;
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && state.board[rr][cc] === player) {
        count++;
        r1 = rr; c1 = cc;
        rr -= dr; cc -= dc;
      }
      if (count >= 5) return { r1, c1, r2, c2 };
    }
    return null;
  }

  // ============================================================
  // AI：启发式评分
  // ============================================================
  // 在一个方向上，从 (r,c) 出发对 player 评分
  // 返回这条线上的"威胁等级"
  // 这是从单点出发扫描 4 个方向，统计自身连子模式
  const PATTERNS = [
    { name: "FIVE",       regex: /11111/,        score: 1000000 },  // 五连
    { name: "LIVE4",      regex: /011110/,       score: 100000 },   // 活四
    { name: "RUSH4_A",    regex: /011112|211110/, score: 10000 },   // 冲四
    { name: "RUSH4_B",    regex: /10111|11011|11101/, score: 10000 }, // 跳冲四
    { name: "LIVE3",      regex: /011100/,       score: 1000 },     // 活三
    { name: "LIVE3_B",    regex: /010110|011010/, score: 1000 },    // 跳活三
    { name: "RUSH3",      regex: /001112|211100|010112|211010|011012|210110/, score: 100 }, // 眠三
    { name: "LIVE2",      regex: /001100|01010|010010/, score: 100 }, // 活二
    { name: "RUSH2",      regex: /000112|211000|001012|210100|010012|210010/, score: 10 },  // 眠二
  ];

  // 把某方向的一条线转成字符串：玩家自己=1，对方=2，空=0，边界=2
  function getLine(board, r, c, dr, dc, player) {
    const opp = player === BLACK ? WHITE : BLACK;
    let s = "";
    for (let i = -5; i <= 5; i++) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) s += "2";  // 边界算对手
      else if (board[rr][cc] === EMPTY) s += "0";
      else if (board[rr][cc] === player) s += "1";
      else s += "2";
    }
    return s;
  }

  // 假设在 (r,c) 落子 player（必须当前为空），计算总威胁分
  function scoreMove(board, r, c, player) {
    board[r][c] = player;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    let total = 0;
    for (const [dr, dc] of dirs) {
      const line = getLine(board, r, c, dr, dc, player);
      for (const p of PATTERNS) {
        if (p.regex.test(line)) {
          total += p.score;
          break;  // 每方向只算最高的那个
        }
      }
    }
    board[r][c] = EMPTY;
    return total;
  }

  // AI 选点：对每个空格，算"我下的攻击分"+"对手下的防守分(按 0.9 权重)"
  // 然后选最高的。这是 1 层评估，毫秒级。
  function aiPickMove() {
    const board = state.board;
    const me = WHITE, opp = BLACK;
    let best = null;
    let bestScore = -Infinity;
    // 优化：只考虑已下棋子周围 2 格内的空位（开局除外）
    const candidates = state.history.length === 0
      ? [{ r: 7, c: 7 }]
      : neighborCandidates(board);
    for (const { r, c } of candidates) {
      const attack = scoreMove(board, r, c, me);
      const defend = scoreMove(board, r, c, opp);
      // 如果攻击能直接赢，立刻走
      if (attack >= 1000000) return { r, c };
      // 如果对手下这里能赢，必须堵
      const score = attack * 1.05 + defend;
      if (score > bestScore) {
        bestScore = score;
        best = { r, c };
      }
    }
    return best;
  }

  function neighborCandidates(board) {
    const seen = new Set();
    const out = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === EMPTY) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
            if (board[rr][cc] !== EMPTY) continue;
            const k = rr * SIZE + cc;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push({ r: rr, c: cc });
          }
        }
      }
    }
    return out;
  }

  function scheduleAIMove() {
    cancelAIMove();
    state.aiThinking = true;
    updateHud();
    aiTimer = setTimeout(() => {
      aiTimer = null;
      if (state.over || state.mode !== "pve" || state.turn !== WHITE) {
        state.aiThinking = false;
        updateHud();
        return;
      }
      const m = aiPickMove();
      state.aiThinking = false;
      if (m) place(m.r, m.c, WHITE);
      else updateHud();
    }, 250);  // 250ms 延迟让玩家感受到"AI 在思考"
  }

  // ============================================================
  // 输入
  // ============================================================
  function getCellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const c = Math.round((px - PADDING) / STEP);
    const r = Math.round((py - PADDING) / STEP);
    return { r, c };
  }

  canvas.addEventListener("mousemove", (e) => {
    if (state.over) { state.hover = null; return; }
    if (state.mode === "pve" && state.turn === WHITE) { state.hover = null; return; }
    const { r, c } = getCellFromEvent(e);
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && state.board[r][c] === EMPTY) {
      state.hover = { r, c };
    } else {
      state.hover = null;
    }
  });
  canvas.addEventListener("mouseleave", () => { state.hover = null; });

  canvas.addEventListener("click", (e) => {
    if (state.over || state.aiThinking) return;
    const { r, c } = getCellFromEvent(e);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
    if (state.board[r][c] !== EMPTY) return;

    // PvE 模式：玩家只能下黑棋
    if (state.mode === "pve") {
      if (state.turn !== BLACK) return;
      if (place(r, c, BLACK) && !state.over) {
        scheduleAIMove();
      }
    } else {
      place(r, c, state.turn);
    }
  });

  // 触屏：直接当作 click 用 pointerdown 触发（避免移动端 300ms 延迟）
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;  // 鼠标已被 click 处理
    if (state.over || state.aiThinking) return;
    const { r, c } = getCellFromEvent(e);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
    if (state.board[r][c] !== EMPTY) return;
    if (state.mode === "pve") {
      if (state.turn !== BLACK) return;
      if (place(r, c, BLACK) && !state.over) {
        scheduleAIMove();
      }
    } else {
      place(r, c, state.turn);
    }
  });

  // 悔棋
  document.getElementById("undoBtn").addEventListener("click", () => {
    if (state.aiThinking || state.history.length === 0) return;
    if (state.over) {
      // 已结束时不允许，避免逻辑混乱
      return;
    }
    // PvE 模式：撤 2 步（玩家 + AI），但如果当前轮到 AI 思考完前撤一次也可
    const undoCount = state.mode === "pve" && state.history.length >= 2 ? 2 : 1;
    for (let i = 0; i < undoCount; i++) {
      const m = state.history.pop();
      if (!m) break;
      state.board[m.r][m.c] = EMPTY;
      state.turn = m.player;
    }
    state.hover = null;
    saveGame();
    updateHud();
  });

  // 重开（保持模式）
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (state.history.length > 0 && !confirm("确定要重开本局吗？")) return;
    if (state.mode) startGame(state.mode);
    else showModePicker(false);
  });

  // ============================================================
  // 渲染
  // ============================================================
  function draw() {
    // 木色底
    ctx.fillStyle = "#c9a875";
    ctx.fillRect(0, 0, W, H);
    // 木纹（淡淡的横向线）
    ctx.fillStyle = "rgba(120, 80, 40, 0.05)";
    for (let i = 0; i < 30; i++) {
      ctx.fillRect(0, i * 20 + (i * 7 % 13), W, 1);
    }

    // 网格线
    ctx.strokeStyle = "#5a3a20";
    ctx.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      const p = PADDING + i * STEP;
      ctx.beginPath();
      ctx.moveTo(PADDING, p);
      ctx.lineTo(W - PADDING, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, PADDING);
      ctx.lineTo(p, H - PADDING);
      ctx.stroke();
    }
    // 边框加粗
    ctx.lineWidth = 2;
    ctx.strokeRect(PADDING, PADDING, W - 2 * PADDING, H - 2 * PADDING);

    // 星位（5 个）
    const stars = [[3,3], [3,11], [11,3], [11,11], [7,7]];
    ctx.fillStyle = "#5a3a20";
    for (const [r, c] of stars) {
      ctx.beginPath();
      ctx.arc(PADDING + c * STEP, PADDING + r * STEP, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 棋子
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (state.board[r][c] === EMPTY) continue;
        drawStone(c, r, state.board[r][c], false);
      }
    }

    // 最后一步标记（红圈）
    if (state.history.length > 0 && !state.winLine) {
      const last = state.history[state.history.length - 1];
      ctx.strokeStyle = "#ff3344";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(PADDING + last.c * STEP, PADDING + last.r * STEP, STEP * 0.22, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 悬停预览
    if (state.hover) {
      const player = state.mode === "pve" ? BLACK : state.turn;
      drawStone(state.hover.c, state.hover.r, player, true);
    }

    // 胜利线
    if (state.winLine) {
      const w = state.winLine;
      ctx.strokeStyle = "#ffd24a";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(PADDING + w.c1 * STEP, PADDING + w.r1 * STEP);
      ctx.lineTo(PADDING + w.c2 * STEP, PADDING + w.r2 * STEP);
      ctx.stroke();
    }
  }

  function drawStone(c, r, player, ghost) {
    const x = PADDING + c * STEP;
    const y = PADDING + r * STEP;
    const radius = STEP * 0.42;
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.45;
    // 阴影
    if (!ghost) {
      ctx.beginPath();
      ctx.arc(x + 1, y + 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fill();
    }
    // 棋子主体（径向渐变）
    const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.15, x, y, radius);
    if (player === BLACK) {
      grad.addColorStop(0, "#666");
      grad.addColorStop(1, "#0a0a0a");
    } else {
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, "#bbbbbb");
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  let frameId = null;
  function loop() {
    if (document.hidden) {
      frameId = null;
      return;
    }
    draw();
    frameId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (frameId === null) frameId = requestAnimationFrame(loop);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) startLoop();
  });

  // ============================================================
  // 启动
  // ============================================================
  const saved = loadGame();
  showModePicker(!!saved);
  state.board = newBoard();  // 占位，picker 期间不让点
  startLoop();
})();
