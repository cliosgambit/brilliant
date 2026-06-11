# Brilliance Engine — Complete Formula Reference (Stages 0–4)

**Document:** `report_2.md`  
**Source of truth:** `backend/brilliance_stage0.py` … `stage4.py`, `brilliance_eval.py`, `brilliance_gates.py`  
**Eval perspective:** All stored centipawn (cp) scores use **White POV** (`+` = White better). Mover POV uses `to_mover_cp()`.

---

## Table of Contents

1. [Pipeline cascade](#1-pipeline-cascade)
2. [Shared constants & eval helpers](#2-shared-constants--eval-helpers)
3. [Stage 0 — Board-only features](#3-stage-0--board-only-features)
4. [Stage 1 — Sacrifice classification](#4-stage-1--sacrifice-classification)
5. [Stage 2 — Shallow Stockfish validation](#5-stage-2--shallow-stockfish-validation)
6. [Stage 3 — Deep Stockfish validation](#6-stage-3--deep-stockfish-validation)
7. [Stage 4 — Human perception model](#7-stage-4--human-perception-model)
8. [Output schemas per stage](#8-output-schemas-per-stage)

---

## 1. Pipeline cascade

```
Every move
  └─ Stage 0  (python-chess, no engine)
       └─ is_sacrifice_candidate → proceed_to_stage1
            └─ Stage 1  (python-chess, no engine)
                 └─ is_valid_sacrifice AND NOT is_forced → proceed_to_stage2
                      └─ Stage 2  (Stockfish d12)
                           └─ gate pass → proceed_to_stage3
                                └─ Stage 3  (Stockfish d5–25)
                                     └─ proceed_to_stage4 (always true if analyzed)
                                          └─ Stage 4  (no engine) → FINAL classification
```

**Strict cascade:** Stages 2–4 only run on moves that passed all upstream gates. Zero upstream passers → downstream stages skipped (empty, status `completed`, count 0).

---

## 2. Shared constants & eval helpers

### 2.1 Piece values (centipawns)

| Piece   | Value |
|---------|-------|
| Pawn    | 100   |
| Knight  | 305   |
| Bishop  | 333   |
| Rook    | 563   |
| Queen   | 950   |
| King    | 0     |

### 2.2 Material

```
material_count(board, color) =
    Σ PIECE_VALUES[pt] × |pieces(pt, color)|   for pt ≠ KING

material_balance(board, color) =
    material_count(board, color) − material_count(board, opponent)
```

### 2.3 Game phase

```
phase_material =
    Σ PIECE_VALUES[pt] × count(pt, c)
    for pt ∈ {Q, R, B, N}, c ∈ {White, Black}

if phase_material > 5800  → "opening"
elif phase_material > 2800 → "middlegame"
else                       → "endgame"

game_phase_code: opening=0, middlegame=1, endgame=2
```

### 2.4 Eval helpers (`brilliance_eval.py`)

```
MATE_SCORE = 10000

cp_from_info_white(info) =
    info["score"].white().score(mate_score=MATE_SCORE)

to_mover_cp(white_cp, color) =
    white_cp                          if color == WHITE
    −white_cp                         if color == BLACK
    None                              if white_cp is None

cpl_from_white_scores(best_white_cp, our_white_cp, color) =
    9999                              if either score is None
    best_white_cp − our_white_cp      if color == WHITE
    our_white_cp − best_white_cp      if color == BLACK

cp_to_ep(cp) =
    0.0                               if cp is None
    1 / (1 + 10^(−cp/400))

linear_slope(xs, ys) =
    ordinary least-squares slope of y vs x
    0.0 if n < 2 or zero denominator

variance(vals) =
    Σ(v − mean)² / n                   (population variance)
    0.0 if empty
```

---

## 3. Stage 0 — Board-only features

**File:** `brilliance_stage0.py`  
**Runs on:** Every move  
**Engine:** None

### 3.1 Static Exchange Evaluation (SEE)

Applies to **capture moves only** (non-captures return `0` from `see()`).

```
gain[0] = value(captured piece on to_square)

Simulate up to 8 recapture plies on destination:
    Each ply: side-to-move plays LVA capture on to_square
    gain[i] = value(piece recaptured)

Backward minimax:
    result = 0
    for i from last down to 0:
        result = gain[i] − max(0, result)

SEE = result    (from mover's perspective on that capture)
```

**LVA (Least Valuable Attacker):** among legal captures to the square, pick minimum `PIECE_VALUES[attacker]`.

### 3.2 Sacrifice candidate gate (`is_sacrifice_candidate`)

```
see_value = SEE(board, move)           if is_capture else 0

dest_attackers  = |attackers(opponent, to_square)|
dest_defenders  = |attackers(mover, to_square)|

positional_risk (non-capture only):
    if dest_attackers > 0:
        board_after = push(move)
        best_opp_cap = opponent LVA capture on to_square (after move)
        opp_see = SEE(board_after, best_opp_cap)
        positional_risk = (opp_see > 50)

is_sacrifice_candidate =
    (see_value < −100)  OR  positional_risk
```

**Thresholds:**
- Material sacrifice: `SEE < −100` cp on the played capture
- Positional risk: opponent profitable capture on destination after quiet move: `opp_see > 50`

**Output gate:**
```
proceed_to_stage1 = is_sacrifice_candidate
```

### 3.3 Piece vulnerability (en prise vs already lost)

**Constants:**
```
OPP_SEE_EN_PRISE_THRESHOLD = 0
SAFE_SQUARE_SEE_THRESHOLD  = 0
CAPTURE_OUT_SEE_MIN        = −100
MIN_ESCAPE_MOBILITY        = 2
```

#### 3.3.1 En prise (local — telemetry only, does NOT disqualify)

Opponent captures evaluated with **opponent to move** on a board copy.

```
en_prise_before_move =
    opponent has attacker(s) on square
    AND opponent_capture_see(board, square, color) > 0
```

#### 3.3.2 Safe escape square

For each legal move of the piece from `square`:

```
After push(move) to dest:

FAIL if dest_opp_see > 0

defenders  = |attackers(mover, dest)|
attackers  = |attackers(opponent, dest)|
tactically_justified = is_check OR is_checkmate
defended_or_justified = defenders > 0 OR tactically_justified OR attackers == 0

mobility = count of legal moves of piece on dest

FAIL if mobility < 2 AND attackers > 0
FAIL if attackers > 0 AND NOT defended_or_justified

Otherwise → safe escape
```

```
safe_escape_squares = count of legal moves from square passing is_safe_escape_square
```

#### 3.3.3 Capture-out (desperado / liquidation)

```
has_capture_out =
    ∃ legal capture from square with SEE(capture) >= −100
```

#### 3.3.4 Absolute pin

```
absolute_pin =
    board.is_pinned(color, square)
    AND removing piece at square leaves king in check
```

#### 3.3.5 Already lost (Stage 1 disqualifier only)

```
if NOT en_prise:
    already_lost_before_move = false

elif safe_escape_squares > 0 OR has_capture_out:
    already_lost_before_move = false

elif absolute_pin AND safe_escapes == 0 AND NOT capture_out:
    already_lost_before_move = true
    reason = "piece_already_lost_before_move"

elif NOT absolute_pin AND safe_escapes == 0 AND NOT capture_out:
    already_lost_before_move = true
    reason = "piece_already_lost_before_move"
```

### 3.4 King safety (opponent king, before/after move)

**Pawn shield** (3×3 front of king):
```
For df ∈ {−1,0,1}, dr ∈ {1,2} with strengths {2,1} toward opponent:
    if own pawn on (kf+df, kr+dr×direction): pawn_shield += strength
```

**Open files near king:**
```
For df ∈ {−1,0,1} on king file ±1:
    no own pawn AND no opp pawn on file → +3
    no own pawn only                  → +1
open_file_penalty = sum
```

**King zone attack** (5×5 around king):
```
attack_weights: Q=5, R=3, B=2, N=2
For each zone square attacked by opponent piece type:
    add weight once per square (first matching piece type)
```

**Castled:** king on g1/c1 (White) or g8/c8 (Black).

```
total_safety =
    pawn_shield × 10
    − open_file_penalty × 15
    − king_zone_attack × 5

opp_king_safety_delta =
    total_safety(after) − total_safety(before)    [opponent king]
```

### 3.5 Tactical multiplexing (TM)

**Attacked enemy pieces:**
```
For each enemy non-king piece attacked by mover:
    undefended = (enemy defenders on square == 0)

new_attacks = enemy pieces newly attacked after move
new_hanging = new_attacks where undefended == true
```

**Fork detection:**
```
Piece on square attacks ≥ 2 enemy pieces with value >= 305
new_forks = forks(after) − forks(before)
```

**Pins:**
```
new_pins = max(0, pinned_enemy_count(after) − pinned_enemy_count(before))
```

**TM score:**
```
multiplexing_score =
    |new_hanging| × 3
  + |new_forks|   × 4
  + new_pins      × 2
  + (999 if checkmate else 0)
  + (5 if check else 0)
  + |new_attacks| × 1
```

### 3.6 Expectation violation (EV)

Violation weights (cumulative `ev_score`):

| Violation | Weight | Condition |
|-----------|--------|-----------|
| `backward_non_capture` | 2 | backward move, not capture, not king |
| `queen_retreat` | 3 | queen backward non-capture |
| `knight_to_rim` | 2 | knight to a/h file |
| `major_piece_to_rim` | 1 | bishop/queen to a/h file |
| `king_walk_middlegame` | 4 | king move in middlegame |
| `moving_apparent_pin` | 5 | piece was pinned |
| `quiet_waiting_move` | 2 | non-capture, not check after move |

```
ev_score = Σ violation weights
```

### 3.7 Piece harmony

```
control_delta = |squares attacked by mover(after)| − |squares attacked(before)|

mobility(b, c) =
    legal_moves(b with turn=c) / max(1, non-king piece count of c)

activity_delta = mobility(after) − mobility(before)

harmony_score = control_delta × 0.3 + activity_delta × 2.0
```

### 3.8 Quiet brilliance detector

```
is_quiet = NOT capture AND NOT check (after move)

ctrl_gain = control(after) − control(before)

opp_mob_loss =
    |legal_moves(opp, before)| − |legal_moves(opp, after)|

xray_alignment:
    rook/queen: same rank or file as opp king
    bishop/queen: same diagonal as opp king

zugzwang (endgame only):
    Sample up to 16 opponent moves; count those that lose material (>30cp)
    or lose >50% mobility
    zugzwang_score = moves_that_worsen / sample_size
    is_likely_zugzwang = zugzwang_score > 0.7

domination:
    Enemy piece (value ≥ knight) with ≥2 legal moves, 0 safe escapes

threat_reduction =
    count(opp checking moves before, first 20) − count(after, first 20)

quiet_score =
    ctrl_gain × 0.3
  + opp_mob_loss × 0.4
  + (5 if xray_alignment else 0)
  + zugzwang_score × 8.0
  + domination_count × 4.0
  + threat_reduction × 1.0

proceed_to_engine (Stage 0 flag only) =
    is_quiet AND quiet_score > 3.0
    (Note: strict cascade uses sacrifice path via Stage 1, not this flag alone)
```

### 3.9 Defensive context

```
material_deficit = max(0, −material_balance(mover))
is_defending     = material_deficit > 150
```

### 3.10 Stage 0 per-move output flags

```
proceed_to_stage1  = is_sacrifice_candidate
proceed_to_engine  = Stage 1 will reach Stage 2 (computed via compute_engine_candidacy)
```

---

## 4. Stage 1 — Sacrifice classification

**File:** `brilliance_stage1.py`  
**Runs on:** Stage 0 sacrifice candidates only  
**Engine:** None

### 4.1 Entry

```
if NOT is_sacrifice_candidate: skip (return None)
```

### 4.2 Disqualifiers (`classify_sacrifice_type`)

Applied in order; any hit → `is_valid_sacrifice = false`.

| # | Disqualifier | Formula |
|---|--------------|---------|
| 1 | `winning_capture_not_sacrifice` | capture AND `see_value >= 150` |
| 2 | `equal_trade_not_sacrifice` | capture AND `see_value >= −100` |
| 3 | `is_recapture_not_sacrifice` | capture AND `last_move.to_square == move.to_square` |
| 4 | `cheapest_attacker_wins_material` | capture AND our LVA on same square has `SEE > 0` AND moving piece value == LVA piece value |
| 5 | `piece_already_lost_before_move` | `analyze_piece_vulnerability(from_sq).already_lost_before_move` |

**Removed:** `capturing_undefended_piece` (undefended target ≠ non-sacrifice).

### 4.3 Sacrifice type (if no disqualifiers)

| Priority | `sac_type` | Condition |
|----------|------------|-----------|
| 1 | `queen_sacrifice` | moving piece is queen |
| 2 | `exchange_sacrifice` | rook capture AND `cap_val < 400` |
| 3 | `positional_piece_placement` | NOT capture |
| 4 | `real_sacrifice` | capture AND `see_value < −300` |
| 5 | `pseudo_sacrifice` | recaptures exist AND `cap_val > 0` AND `cap_val >= if_val × 0.8` |
| 6 | `tactical_sacrifice` | default capture |
| — | `unknown` | if disqualified |

### 4.4 Pseudo-sacrifice flag

```
recaptures = opponent legal captures on to_square (after move)

is_pseudo =
    len(recaptures) > 0
    AND cap_val > 0
    AND cap_val >= if_val × 0.8
```

### 4.5 Sacrifice uncertainty

```
scenarios = [see_value if capture else cap_val − if_val]

For each recapture in recaptures[:5]:
    push recapture
    val_diff = value(piece_left_on_sq) − if_val  (or −if_val if empty)
    scenarios.append(val_diff)

sacrifice_uncertainty = variance(scenarios)
```

### 4.6 Forced move

```
n_legal = |legal_moves|

is_forced = true, reason = "only_legal_move"           if n_legal == 1
is_forced = true, reason = "check_few_options"         if in_check AND n_legal <= 3
else is_forced = false
```

### 4.7 Stage 1 gate

```
is_valid_sacrifice = (len(disqualifiers) == 0)

proceed_to_stage2 = is_valid_sacrifice AND NOT is_forced

gate_fail_reason =
    first disqualifier, OR forced reason if forced
```

### 4.8 Stage 1 game aggregates

```
candidate_count         = |sacrifice candidates|
valid_sacrifice_count   = count(is_valid_sacrifice)
proceed_to_stage2_count = count(proceed_to_stage2)
forced_move_count       = count(is_forced)
disqualified_count      = candidate_count − valid_sacrifice_count
```

---

## 5. Stage 2 — Shallow Stockfish validation

**File:** `brilliance_stage2.py`  
**Runs on:** Stage 1 passers (`proceed_to_stage2`)  
**Engine:** Stockfish depth 12 (MultiPV 5), depth 10 fallbacks

### 5.1 Entry gate

```
resolve_engine_candidate → Stage 1 proceed_to_stage2 required
else skip (return None)
```

### 5.2 Stage 2.0 — Engine preservation check (en prise pieces)

**Constants:**
```
PIECE_SURVIVAL_PLIES = 4
LOSS_THRESHOLD_FLOOR = 150
LOSS_THRESHOLD_PIECE_FRACTION = 0.7
STAGE20_ENGINE_DEPTH = 8
```

**Skip if:** not en prise.

```
threshold = max(0.7 × piece_value, 150)

current_mover = to_mover_cp(eval(board, d=8), color)

For each legal move preserving piece (from_square):
    push move
    if piece_survives_plies(dest, 4 plies of engine best lines):
        ev = to_mover_cp(eval(after, d=8), color)
        track best_save_eval = max(ev)

if no preservation line:
    already_lost_engine = true
else:
    delta = best_save_eval − current_mover
    already_lost_engine = (delta < −threshold)
```

**Early fail:**
```
if already_lost_engine:
    proceed_to_stage3 = false
    gate_fail_reason = "piece_already_lost_engine_confirmed"
    classification_if_fail = "unsound_sacrifice"
    (skip shallow Stage 2 analysis)
```

### 5.3 Shallow engine features

**Before move (d=12):**
```
pre_move_eval_white = cp_from_info_white(root d=12)
pre_move_eval_mover = to_mover_cp(pre_move_eval_white, color)

MultiPV 5 at d=12:
    best_score = cp of line 1
    best_move  = PV[0] of line 1

Find our move in top-5:
    our_score_white, our_rank (1–5, or 99 if absent)

If not in top-5:
    our_score_white = eval(after_move, d=10)
    our_rank = 99
```

**CPL:**
```
cpl_shallow = cpl_from_white_scores(best_score, our_score_white, color)
```

**Engine-forced detection:**
```
reasonable = { lines in top-5 where CPL(line, best) <= 150 }
is_forced_engine = (len(reasonable) <= 2)
n_reasonable_moves = len(reasonable)
```

**Expected points (mover POV):**
```
best_mover = to_mover_cp(best_score, color)
our_mover  = to_mover_cp(our_score_white, color)

ep_before  = cp_to_ep(best_mover)
ep_after   = cp_to_ep(our_mover)
ep_delta_shallow = ep_after − ep_before
ep_pre_position  = cp_to_ep(pre_move_eval_mover)
```

**Response width (after move, opponent d=10 MultiPV 8):**
```
opp_best = cp of opponent line 1
response_width = count of lines where |opp_best − line_cp| <= 120
```

**Near-best flag:**
```
is_best_or_near_best = (cpl_shallow <= 50)
```

### 5.4 Stage 2 gate (`apply_stage2_gate`)

Evaluated in order; first failure wins:

| Order | Fail reason | Condition |
|-------|-------------|-----------|
| 1 | `cpl_too_high` | `cpl_shallow > 300` |
| 2 | `position_already_winning` | `ep_pre_position >= 0.80` |
| 3 | `ep_delta_too_negative` | `ep_delta_shallow < −0.15` |
| 4 | `forced_engine` | `is_forced_engine == true` |

```
proceed_to_stage3 = (fail is None)

classification_if_fail =
    "unsound_sacrifice"     if fail ∈ {cpl_too_high, ep_delta_too_negative, position_already_winning}
    "forced_best_move"      if fail == forced_engine
    None                    if pass
```

### 5.5 Stage 2 game aggregates

```
analyzed_count          = |Stage 2 moves|
proceed_to_stage3_count = count(proceed_to_stage3)
disqualified_count      = analyzed − proceed
forced_engine_count     = count(gate == forced_engine)
unsound_count           = count(gate ∈ {cpl_too_high, ep_delta_too_negative})
```

---

## 6. Stage 3 — Deep Stockfish validation

**File:** `brilliance_stage3.py`  
**Runs on:** Stage 2 passers  
**Engine:** Stockfish depths 5, 10, 15, 20, 25 + rank searches

### 6.1 Entry

```
Stage 2 proceed_to_stage3 required (re-runs Stage 2 inline unless ply_indices override)
```

### 6.2 Depth curve (position **after** move)

```
DEPTH_CURVE = [5, 10, 15, 20, 25]

depth_evals_white[d] = cp_from_info_white(analyse(after, depth=d))
depth_evals_mover[d] = to_mover_cp(depth_evals_white[d], color)

early_avg = mean(eval@5, eval@10)
late_avg  = mean(eval@20, eval@25)
depth_gain = late_avg − early_avg
is_rising_curve = (early_avg < 0) AND (late_avg > 0)

depth_slope    = linear_slope(DEPTH_CURVE, depth_evals_mover)
depth_variance = variance(depth_evals_mover)
```

### 6.3 Soundness

```
deep_eval_white = depth_evals_white[25]
deep_eval_mover = to_mover_cp(deep_eval_white, color)

is_sound = (deep_eval_mover >= −30)
deep_ep_mover = cp_to_ep(deep_eval_mover)
```

### 6.4 Rank jump (position **before** move)

```
rank_at_depth8  = rank of played move in MultiPV 10 @ d=8  (1–99)
rank_at_depth22 = rank of played move in MultiPV 5  @ d=22 (1–99)

rank_jump = rank_at_depth8 − rank_at_depth22

is_non_obvious = (rank_at_depth8 >= 5) AND (rank_at_depth22 <= 2)
```

### 6.5 Defense difficulty (after move, opponent d=18 MultiPV 8)

```
opp_best = cp of opponent line 1

good_defenses = count of lines where |opp_best − line_cp| <= 100

defense_difficulty = 1.0 − (good_defenses / max(1, len(opp_results)))
```

Range: `[0, 1]` — higher = harder to defend.

### 6.6 Deep CPL

```
best_deep_white = cp of d=22 MultiPV line 1
cpl_deep = cpl_from_white_scores(best_deep_white, deep_eval_white, color)
is_near_best_deep = (cpl_deep <= 50)
```

### 6.7 Counterfactual delta

```
best_alt_move = d=22 best move if ≠ played, else 2nd best

If best_alt exists:
    alt_eval @ d=20 after alt move
    counterfactual_delta = deep_eval_mover − alt_eval_mover
else:
    counterfactual_delta = 0
```

### 6.8 Non-obvious score (Stage 3 composite)

```
non_obvious_score =
    (1 if is_rising_curve else 0) × 3
  + (min(depth_gain, 500) / 500) × 3
  + (min(max(rank_jump, 0), 8) / 8) × 2
  + (1 if is_non_obvious else 0) × 2

Maximum theoretical value: 10.0
```

| Component | Max points |
|-----------|------------|
| Rising depth curve | 3 |
| Depth gain (capped 500cp) | 3 |
| Rank jump (capped 8) | 2 |
| Non-obvious rank flip | 2 |

### 6.9 Stage 3 gate (`apply_stage3_gate`)

**Note:** Stage 3 does **not** block Stage 4. It tags unsound moves.

```
unsound_reasons = []
if NOT is_sound:           append "deep_eval_below_threshold"
if NOT is_near_best_deep:   append "cpl_deep_too_high"

proceed_to_stage4 = true   (always, if analyzed)

classification_if_unsound =
    None                    if no unsound reasons
    "speculative_sacrifice" if any unsound reason
```

### 6.10 Stage 3 game aggregates

```
analyzed_count     = |Stage 3 moves|
sound_count        = count(is_sound)
unsound_count      = analyzed − sound
rising_curve_count = count(is_rising_curve)
non_obvious_count  = count(is_non_obvious)
```

---

## 7. Stage 4 — Human perception model

**File:** `brilliance_stage4.py`  
**Runs on:** Stage 3 passers (`proceed_to_stage4 = 1`)  
**Engine:** None

### 7.1 Inputs (assembled from Stages 0–3)

| Input | Source |
|-------|--------|
| `player_rating` | PGN `WhiteElo`/`BlackElo` (default 1500) |
| `ev_score` | Stage 0 |
| `multiplexing_score` | Stage 0 |
| `king_safety_delta` | Stage 0 (`opp_king_safety_delta`) |
| `game_phase` | Stage 0 |
| `is_check`, `is_capture` | Stage 0 |
| `quiet_score`, `material_deficit` | Stage 0 |
| `sac_type` | Stage 1 |
| `rank_at_depth8` | Stage 3 |
| `non_obvious_score` | Stage 3 |
| `defense_difficulty` | Stage 3 |
| `is_sound`, `deep_eval_mover_cp` | Stage 3 |
| `pre_move_eval_mover_cp` | Stage 2 |
| `fen_before`, `uci_move` | Stage 0 (defensive branch) |

**Defensive flag:**
```
is_defensive =
    material_deficit > 150
    OR material_balance_before < −150
```

### 7.2 Rating-relative surprise

**Rating brackets → `rating_factor`:**

| Elo range | Factor |
|-----------|--------|
| 0 – 1099 | 0.4 |
| 1100 – 1499 | 0.3 |
| 1500 – 1899 | 0.2 |
| 1900 – 2299 | 0.1 |
| 2300 – 2699 | 0.05 |
| 2700+ | 0.01 |

**Type multipliers:**

| `sac_type` | Multiplier |
|------------|------------|
| `queen_sacrifice` | 2.5 |
| `exchange_sacrifice` | 1.8 |
| `real_sacrifice` | 1.6 |
| `positional_piece_placement` | 2.0 |
| `tactical_sacrifice` | 1.2 |
| `pseudo_sacrifice` | 0.8 |
| other | 1.0 |

**Formulas:**
```
base_non_obvious = min(rank_at_depth8, 10) / 10.0

ev_bonus = ev_score × 0.15

surprise_score = min(10.0,
    (base_non_obvious + rating_factor + ev_bonus) × type_multiplier × 5.0
)

p_find = max(0.001, 1.0 − surprise_score / 10.0)
info_surprise_bits = −log₂(p_find)

brilliant_for_rating = (surprise_score > 6.0)
```

### 7.3 Practical brilliance score

```
obj_quality = clamp((deep_eval_mover_cp + 200) / 400, 0, 1)

practical_value = defense_difficulty × (min(tm_score, 20) / 20)

tal_zone = (−200 <= deep_eval_mover_cp < −30)

if is_sound:
    pb_score  = obj_quality × defense_difficulty × 10.0
    category  = "objective_brilliant"

elif tal_zone AND defense_difficulty > 0.7:
    pb_score  = practical_value × 7.0
    category  = "practical_brilliant"

else:
    pb_score  = practical_value × 3.0
    category  = "speculative_sacrifice"
```

### 7.4 Brilliance archetype (decision tree)

```
if is_quiet AND NOT is_check:
    "endgame_revelation"  if endgame
    else "quiet_masterstroke"

elif is_defensive:
    "defensive_brilliance"

elif sac_type == queen_sacrifice AND king_safety_delta < −100:
    "thunderbolt"

elif sac_type == exchange_sacrifice:
    "strategic_masterstroke"

elif is_check AND king_safety_delta < −80:
    "ignition"

elif endgame:
    "endgame_coup"

else:
    "masterstroke"
```

### 7.5 Defensive brilliance (optional sub-model)

When `is_defensive` and FEN/move available:

```
is_losing         = pre_move_eval < −150
is_clearly_losing = pre_move_eval < −400
eval_rescue       = post_move_eval − pre_move_eval
achieves_draw     = −50 <= post_move_eval <= 50

perpetual  = detect_perpetual_check (depth 10 search)
stalemate  = detect_stalemate_trap (first 15 opp moves)

base = 0
if is_losing:
    +8.0 if perpetual.has_perpetual        → archetype perpetual_save
    +9.0 if stalemate.has_trap             → archetype stalemate_brilliance
    +5.0 if achieves_draw (no perp/trap)   → archetype defensive_fortress
    +2.0 if is_clearly_losing
    +min(3.0, eval_rescue / 200)

defensive_score = base
is_defensive_brilliant = (defensive_score >= 6.0)

If is_defensive_brilliant: override archetype with defensive_archetype
```

### 7.6 Final brilliance score & classification

**Base composite:**
```
brilliance =
    non_obvious_score   × 0.30
  + surprise_score      × 0.25
  + pb_score            × 0.20
  + defense_difficulty  × 10 × 0.10
  + multiplexing_score  × 0.10
  + ev_score            × 0.05
```

**Bonuses:**
```
if quiet_score > 2.0:
    brilliance += (quiet_score / 10.0) × 2.0

if is_defensive:
    brilliance += min(material_deficit, 500) / 500 × 2.0
    if defensive_score >= 6.0:
        brilliance += defensive_score × 0.15

brilliance_score = round(brilliance, 2)
```

**Classification thresholds:**

| Classification | Condition |
|----------------|-----------|
| **`BRILLIANT`** | `brilliance_score >= 6.5` **AND** `is_sound` |
| **`practical_brilliant`** | `brilliance_score >= 5.0` **OR** `defensive_score >= 6.0` |
| **`great_sacrifice`** | `brilliance_score >= 3.5` |
| **`good_sacrifice`** | else |

```
is_brilliant = (classification == "BRILLIANT")
```

### 7.7 Stage 4 game aggregates

```
analyzed_count            = |Stage 4 moves|
brilliant_count           = count(is_brilliant)
practical_brilliant_count = count(classification ∈ {BRILLIANT, practical_brilliant})
```

---

## 8. Output schemas per stage

### Stage 0 — key per-move fields

| Field | Type |
|-------|------|
| `see_value`, `is_sacrifice_candidate`, `is_capture` | numeric/bool |
| `piece_vulnerability.en_prise_before_move` | bool |
| `piece_vulnerability.already_lost_before_move` | bool |
| `multiplexing_score`, `ev_score`, `harmony_score` | numeric |
| `king_safety.opp_king_safety_delta` | numeric |
| `proceed_to_stage1` | bool |

### Stage 1 — key per-move fields

| Field | Type |
|-------|------|
| `sacrifice_class.sac_type` | enum |
| `sacrifice_class.disqualifiers[]` | string[] |
| `is_valid_sacrifice`, `is_forced`, `proceed_to_stage2` | bool |
| `gate_fail_reason` | string |
| `sacrifice_uncertainty`, `material_loss_cp` | numeric |

### Stage 2 — key per-move fields

| Field | Type |
|-------|------|
| `cpl_shallow`, `ep_delta_shallow`, `ep_pre_position` | numeric |
| `is_forced_engine`, `response_width` | numeric/bool |
| `preservation_check` | Stage 2.0 object (if en prise) |
| `proceed_to_stage3`, `gate_fail_reason` | bool/string |

### Stage 3 — key per-move fields

| Field | Type |
|-------|------|
| `deep_eval_mover_cp`, `is_sound`, `cpl_deep` | numeric/bool |
| `rank_at_depth8`, `rank_at_depth22`, `rank_jump` | numeric |
| `non_obvious_score`, `defense_difficulty` | numeric |
| `is_rising_curve`, `is_non_obvious` | bool |
| `proceed_to_stage4`, `classification_if_unsound` | bool/string |

### Stage 4 — key per-move fields (FINAL)

| Field | Type | Values |
|-------|------|--------|
| `brilliance_score` | float | 0–10+ |
| `classification` | enum | `BRILLIANT`, `practical_brilliant`, `great_sacrifice`, `good_sacrifice` |
| `is_brilliant` | bool | true only for `BRILLIANT` |
| `archetype` | enum | see §7.4 |
| `surprise_score`, `pb_score` | float | |
| `pb_category` | enum | `objective_brilliant`, `practical_brilliant`, `speculative_sacrifice` |
| `brilliant_for_rating` | bool | surprise > 6 |

---

## Appendix A — Threshold quick reference

| Threshold | Value | Stage |
|-----------|-------|-------|
| Sacrifice SEE | < −100 | 0 |
| Positional risk opp SEE | > 50 | 0 |
| Winning capture SEE | ≥ 150 | 1 |
| Equal trade SEE | ≥ −100 | 1 |
| Real sacrifice SEE | < −300 | 1 |
| Material deficit defending | > 150 cp | 0/4 |
| Forced (in check) | ≤ 3 legal moves | 1 |
| CPL shallow fail | > 300 | 2 |
| EP pre winning | ≥ 0.80 | 2 |
| EP delta fail | < −0.15 | 2 |
| Reasonable moves CPL | ≤ 150 | 2 |
| Forced engine | ≤ 2 reasonable lines | 2 |
| Near-best CPL | ≤ 50 | 2/3 |
| Sound deep eval | ≥ −30 cp mover | 3 |
| Deep CPL near-best | ≤ 50 | 3 |
| Non-obvious rank | d8 ≥ 5, d22 ≤ 2 | 3 |
| BRILLIANT score | ≥ 6.5 + sound | 4 |
| Practical brilliant | ≥ 5.0 or def ≥ 6 | 4 |
| Great sacrifice | ≥ 3.5 | 4 |
| Preservation loss threshold | max(0.7×piece, 150) | 2.0 |
| Piece survival plies | 4 | 2.0 |

---

## Appendix B — Source files

| Stage | Python | Node service |
|-------|--------|--------------|
| 0 | `brilliance_stage0.py` | `brillianceStage0Service.js` |
| 1 | `brilliance_stage1.py` | `brillianceStage1Service.js` |
| 2 | `brilliance_stage2.py` | `brillianceStage2Service.js` |
| 3 | `brilliance_stage3.py` | `brillianceStage3Service.js` |
| 4 | `brilliance_stage4.py` | `brillianceStage4Service.js` |
| Eval | `brilliance_eval.py` | — |
| Gates | `brilliance_gates.py` | `brilliancePipelineService.js` |

*Generated from live codebase. Re-run pipeline after formula changes to refresh stored game data.*
