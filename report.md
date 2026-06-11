# Brilliance Move Analysis — Technical Report

Complete reference for the **Last Shot** brilliance pipeline: every stage, filter, formula, file, database table, Stockfish usage, and frontend surface.

**Reference design documents (repo root):**
- `brilliance_input_layer (1).html` — Stage 0–4 cascade, SEE, CPL/EP gates
- `brilliance_part2_model (1).html` — Quiet/defensive detectors, 52-feature vector, human model
- `chess_move_classification_report (2).html` — Standard CPL move labels (Best/Excellent/…/Blunder)

**Current cascade mode:** **Strict input-layer cascade** — Stage 2 runs **only** on Stage 1 passers (valid sacrifice + not forced). Part 2 quiet/defensive parallel engine paths are computed at Stage 0 for context but do **not** bypass Stage 1.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React / Vite)                                                    │
│  BrillianceStagesPanel → StageZeroPanel … StageFourPanel                    │
│  POST /api/lichess-pgns/games/:id/brilliance/run                            │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│  BACKEND (Node.js / Express)                                                │
│  brilliancePipelineService → stage0…stage4 Services                         │
│  execFile(python, [brilliance_stageN.py, JSON])                             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│  PYTHON (python-chess + Stockfish UCI)                                      │
│  brilliance_stage0.py … brilliance_stage4.py                                │
│  brilliance_gates.py · brilliance_eval.py                                   │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│  STOCKFISH                                                                  │
│  stockfish/stockfish-windows-x86-64-avx2.exe                                │
│  Stage 2: depth 12 multipv 5 · Stage 3: d5–25 curve, d8/d22 rank, d18 def  │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼─────────────────────────────────────────┐
│  DATABASE (SQLite)                                                          │
│  lichess_pgn_games · lichess_pgn_moves · lichess_pgn_stage0 … stage4        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Typical move funnel (game 202, strict cascade)

| Stage | Input | Output | Engine? |
|-------|-------|--------|---------|
| 0 | All moves (~35) | Sacrifice flags, board features | No |
| 1 | Sacrifice candidates (~4) | Valid sacrifice + forced filter (~3 pass) | No |
| 2 | Stage 1 passers (~3) | CPL/EP shallow gates (~1 pass) | Stockfish d12 |
| 3 | Stage 2 passers (~1) | Depth curve, soundness (~1 sound) | Stockfish d25 |
| 4 | Stage 3 passers (~1) | Human model, classification | No |

---

## 2. Shared Eval Conventions

**File:** `backend/brilliance_eval.py`

| Symbol | Formula | Notes |
|--------|---------|-------|
| `EVAL_PERSPECTIVE` | `"white"` | All stored cp in DB use white POV |
| `cp_from_info_white(info)` | `info["score"].white().score(mate_score=10000)` | From Stockfish analyse result |
| `to_mover_cp(white_cp, color)` | `white_cp` if White else `-white_cp` | Mover-relative eval |
| `cpl_from_white_scores(best, our, color)` | `best - our` (White) · `our - best` (Black) | Centipawn loss vs best line |
| `cp_to_ep(cp)` | `1 / (1 + 10^(-cp/400))` | Logistic win-probability (Elo-style) |
| `linear_slope(xs, ys)` | Standard least-squares slope | Depth curve |
| `variance(vals)` | Population variance | Depth curve stability |

---

## 3. Stage 0 — Board-Only Feature Extraction

### Purpose
Run on **every move**. Zero engine calls. Identify sacrifice candidates and extract tactical/positional signals.

### Files
| Layer | Path |
|-------|------|
| Python | `backend/brilliance_stage0.py` |
| Gates | `backend/brilliance_gates.py` → `compute_engine_candidacy()` |
| Node service | `backend/services/brillianceStage0Service.js` |
| Frontend | `frontend/src/components/StageZeroPanel.jsx` |
| DB table | `lichess_pgn_stage0` |

### Piece values (centipawns)

```
PAWN=100  KNIGHT=305  BISHOP=333  ROOK=563  QUEEN=950  KING=0
```

### Game phase

Total non-king piece value on board (both colors):

```
total = Σ PIECE_VALUES[pt] × count(pt)  for Q,R,B,N

opening      if total > 5800
middlegame   if total > 2800
endgame      otherwise
```

### Static Exchange Evaluation (SEE)

For captures only. LVA capture chain up to depth 8:

```
gain[i] accumulated per capture in sequence
result = backward induction: result = gain[i] - max(0, result)
```

Non-captures: `see_value = 0`.

### Sacrifice candidate gate (Stage 0 → Stage 1)

```
see_val = see(board, move)           if capture else 0
positional_risk = (not capture) AND (dest_attackers > 0) AND moving_piece exists

is_sacrifice_candidate = (see_val < -50) OR positional_risk
proceed_to_stage1 = is_sacrifice_candidate
```

### Hanging piece (pre-move)

Square attacked with no defenders → hanging.  
With defenders: LVA attacker SEE > 0 → hanging.

### King safety (opponent)

Components per opponent king:
- `pawn_shield`: pawns on adjacent ranks (+2 near, +1 two ranks away)
- `open_file_penalty`: open/semi-open files near king
- `king_zone_attack`: weighted attacks in 5×5 king zone (Q=5, R=3, B/N=2)

```
total_safety = pawn_shield×10 - open_file_penalty×15 - zone_attack×5
king_safety_delta = opp_after.total_safety - opp_before.total_safety
```

### Tactical multiplexing (TM)

After move, compare before/after:

```
new_attacks, new_hanging, new_forks, new_pins
is_check, is_checkmate

tm_score = new_hanging×3 + new_forks×4 + new_pins×2
         + (999 if checkmate else 0) + (5 if check else 0) + new_attacks×1
```

### Expectation violation (EV)

Human-expectation “weirdness” weights:

| Violation | Weight |
|-----------|--------|
| backward_non_capture | 2 |
| queen_retreat (non-capture) | 3 |
| knight_to_rim | 2 |
| major_piece_to_rim (B/Q) | 1 |
| king_walk_middlegame | 4 |
| moving_apparent_pin | 5 |
| quiet_waiting_move (non-capture, non-check) | 2 |

```
ev_score = sum(weights)
```

### Piece harmony

```
control_delta = squares_attacked_after - squares_attacked_before
activity_delta = (legal_moves/pieces)_after - (legal_moves/pieces)_before
harmony_score = control_delta×0.3 + activity_delta×2.0
```

### Quiet brilliance detector (Part 2 — context only at Stage 0)

Computed for all moves; used in Stage 4 scoring, **not** Stage 2 entry in strict mode.

```
is_quiet = (not capture) AND (not check after move)

ctrl_gain = controlled_squares_after - controlled_squares_before
opp_mob_loss = opp_legal_moves_before - opp_legal_moves_after
xray_alignment = rook/queen file/rank align to opp king, or bishop diagonal
zugzwang (endgame only): ratio of opp moves that worsen material/mobility
domination: opp piece (≥ knight value, ≥2 legal moves) with 0 safe escapes

quiet_score = ctrl_gain×0.3 + opp_mob_loss×0.4
            + (5 if xray) + zugzwang_score×8 + domination_count×4
            + threat_reduction×1

proceed_to_engine (quiet) = is_quiet AND quiet_score > 3.0   [informational only]
```

### Defensive context (Part 2 — context only)

```
material_balance = own_material - opp_material
material_deficit = max(0, -material_balance)
is_defending = material_deficit > 150
```

### Stage 0 → Stage 2 preview flag

Via `compute_engine_candidacy()` (runs Stage 1 logic without persisting):

```
proceed_to_engine = Stage1.proceed_to_stage2   // valid sacrifice AND not forced
```

### Stage 0 DB columns

`game_phase`, `see_value`, `is_sacrifice_candidate`, `was_piece_hanging`, `king_safety_delta`, `multiplexing_score`, `ev_score`, `harmony_score`, `control_delta`, `activity_delta`, `is_check`, `proceed_to_stage1`, `features_json` (full JSON blob).

---

## 4. Stage 1 — Sacrifice Classification

### Purpose
Run **only** on Stage 0 sacrifice candidates. Disqualify trades, hanging-piece recaptures, forced moves.

### Files
| Layer | Path |
|-------|------|
| Python | `backend/brilliance_stage1.py` |
| Node service | `backend/services/brillianceStage1Service.js` |
| Frontend | `frontend/src/components/StageOnePanel.jsx` |
| DB table | `lichess_pgn_stage1` |

### Sacrifice type classification

After disqualifier check:

| Condition | `sac_type` |
|-----------|------------|
| Queen moving | `queen_sacrifice` |
| Rook capture, captured < 400cp | `exchange_sacrifice` |
| mat_loss > -400, not pseudo | `real_sacrifice` |
| Pseudo (recapture likely, cap ≥ 80% piece value) | `pseudo_sacrifice` |
| Non-capture | `positional_piece_placement` |
| Else | `tactical_sacrifice` |

### Disqualifiers (invalid sacrifice)

```
trade_not_sacrifice:     capture AND |piece_value - captured_value| < 80
piece_was_already_hanging: was_piece_hanging(from_square)
```

```
is_valid_sacrifice = len(disqualifiers) == 0
```

### Forced move filter

```
only_legal_move:     n_legal == 1
check_few_options:   in_check AND n_legal <= 3
is_forced = either above
```

### Stage 1 gate → Stage 2

```
proceed_to_stage2 = is_valid_sacrifice AND NOT is_forced
```

Fail reasons stored: `trade_not_sacrifice`, `piece_was_already_hanging`, `only_legal_move`, `check_few_options`.

### Sacrifice uncertainty

Variance of material outcomes across recapture scenarios (up to 5 recaptures).

---

## 5. Stage 2 — Shallow Stockfish Validation

### Purpose
First engine stage. Confirms shallow soundness, CPL, forced-move density, response width.

### Files
| Layer | Path |
|-------|------|
| Python | `backend/brilliance_stage2.py` |
| Gates | `backend/brilliance_gates.py` → `resolve_engine_candidate()` |
| Node service | `backend/services/brillianceStage2Service.js` |
| Frontend | `frontend/src/components/StageTwoPanel.jsx` |
| DB table | `lichess_pgn_stage2` |

### Stockfish configuration

```
Binary: stockfish/stockfish-windows-x86-64-avx2.exe
Threads: 1, Hash: 128MB, MultiPV: 8 (configured)
Root analyse: depth 12, multipv 5
Fallback (move not in top-5): analyse after-move position depth 10
Opponent response scan: after-move depth 10, multipv 8
Timeout (Node): 600000ms (10 min per game)
```

### Entry gate

```
resolve_engine_candidate():
  ONLY if analyze_stage1_move().proceed_to_stage2 == True
  candidate_path = "sacrifice"
```

### Shallow engine features

**Pre-move eval:**
```
pre_move_eval_white = cp_from_info_white(root depth-12)
pre_move_eval_mover = to_mover_cp(pre_move_eval_white, color)
ep_pre_position = cp_to_ep(pre_move_eval_mover)
```

**Best line & our line (multipv 5 at depth 12):**
```
best_score = white POV of multipv[0]
our_score_white = white POV of line matching played move (or depth-10 after-move if absent)
our_rank_in_top5 = 1-based index (99 if not in top 5)
```

**Centipawn loss:**
```
cpl_shallow = cpl_from_white_scores(best_score, our_score_white, color)
is_best_or_near_best = cpl_shallow <= 50
```

**Engine forced-move proxy:**
```
reasonable = lines where cpl_from_white_scores(best, line, color) <= 150
n_reasonable_moves = len(reasonable)
is_forced_engine = n_reasonable_moves <= 2
```

**Expected points delta (mover POV):**
```
best_mover = to_mover_cp(best_score, color)
our_mover  = to_mover_cp(our_score_white, color)
ep_before  = cp_to_ep(best_mover)      // vs best alternative
ep_after   = cp_to_ep(our_mover)
ep_delta_shallow = ep_after - ep_before
```

**Opponent response width:**
```
opp_best = white POV best reply after our move
response_width = count of opp lines within 120cp of opp_best
```

### Stage 2 disqualifiers (ALL must pass)

| Gate | Condition | Fail reason | Classification |
|------|-----------|-------------|----------------|
| CPL | `cpl_shallow > 300` | `cpl_too_high` | `unsound_sacrifice` |
| Pre-position | `ep_pre_position >= 0.80` | `position_already_winning` | `unsound_sacrifice` |
| EP delta | `ep_delta_shallow < -0.15` | `ep_delta_too_negative` | `unsound_sacrifice` |
| Forced | `is_forced_engine == True` | `forced_engine` | `forced_best_move` |

```
proceed_to_stage3 = all gates pass (fail is None)
```

Pre-position gate from **chess_move_classification_report** Gate 5: brilliance suppressed when already winning (EP ≥ 0.80 before move, mover POV).

---

## 6. Stage 3 — Deep Stockfish Validation

### Purpose
Expensive confirmation: depth curve, non-obviousness, defense difficulty, deep soundness.

### Files
| Layer | Path |
|-------|------|
| Python | `backend/brilliance_stage3.py` |
| Node service | `backend/services/brillianceStage3Service.js` |
| Frontend | `frontend/src/components/StageThreePanel.jsx` |
| DB table | `lichess_pgn_stage3` |

### Entry

Node passes `ply_indices` from DB:
```sql
SELECT ply_index FROM lichess_pgn_stage2 WHERE proceed_to_stage3 = 1
```
Python skips re-running Stage 2 gate when `ply_indices` provided.

### Stockfish configuration

```
Threads: 1, Hash: 256MB, MultiPV: 10
Depth curve: [5, 10, 15, 20, 25] on position AFTER move
Rank shallow: root multipv 10 @ depth 8
Rank deep:    root multipv 5  @ depth 22
Defense:      after-move multipv 8 @ depth 18
Counterfactual: best alt @ depth 20
Timeout (Node): 900000ms (15 min)
```

### Depth curve features

```
depth_evals_mover[d] = to_mover_cp(eval_at_depth_d, color)
depth_slope = linear_slope(DEPTH_CURVE, depth_evals_mover)
early_avg = mean(d5, d10)
late_avg  = mean(d20, d25)
depth_gain = late_avg - early_avg
is_rising_curve = (early_avg < 0) AND (late_avg > 0)
depth_variance = variance(depth_evals_mover)
```

### Deep soundness gate

```
deep_eval_mover = to_mover_cp(eval@d25, color)
is_sound = deep_eval_mover >= -30     // input-layer: not losing at full depth
```

### Non-obviousness

```
rank_at_depth8  = rank in multipv@d8  (99 if absent)
rank_at_depth22 = rank in multipv@d22
rank_jump = rank_at_depth8 - rank_at_depth22
is_non_obvious = (rank_at_depth8 >= 5) AND (rank_at_depth22 <= 2)

cpl_deep = cpl_from_white_scores(best@d22, eval@d25, color)
is_near_best_deep = cpl_deep <= 50
```

### Defense difficulty

```
good_defenses = opp replies within 100cp of opp_best @ d18
defense_difficulty = 1 - (good_defenses / len(opp_results))
```

### Counterfactual delta

```
If best_alt != played move:
  counterfactual_delta = deep_eval_mover(played) - deep_eval_mover(best_alt@d20)
```

### Non-obvious score (composite)

```
non_obvious_score = (1 if rising_curve else 0)×3
                  + min(depth_gain,500)/500×3
                  + min(max(rank_jump,0),8)/8×2
                  + (1 if is_non_obvious else 0)×2
```

### Stage 3 gate → Stage 4

```
unsound if NOT is_sound OR NOT is_near_best_deep
proceed_to_stage4 = True always (even unsound → speculative_sacrifice label)
classification_if_unsound = "speculative_sacrifice" when unsound
```

Stage 4 still runs on all Stage 3 rows with `proceed_to_stage4 = 1`.

---

## 7. Stage 4 — Human Perception Model

### Purpose
Rating-relative surprise, practical brilliance, defensive bonuses, final classification. **No engine.**

### Files
| Layer | Path |
|-------|------|
| Python | `backend/brilliance_stage4.py` |
| Node service | `backend/services/brillianceStage4Service.js` (builds inputs from stage0–3 DB) |
| Frontend | `frontend/src/components/StageFourPanel.jsx` |
| DB table | `lichess_pgn_stage4` |

### Inputs assembled in Node (`buildStage4Inputs`)

From stage 3 passers + joined stage 0/1/2:
- `player_rating` from PGN metadata (default 1500)
- `ev_score`, `multiplexing_score`, `king_safety_delta`, `game_phase`, `is_check`, `is_capture`
- `rank_at_depth8`, `non_obvious_score`, `defense_difficulty`, `is_sound`, `deep_eval_mover_cp`
- `quiet_score`, `material_deficit`, `fen_before`, `uci_move`, `pre_move_eval_mover_cp`
- `is_defensive = material_deficit > 150 OR material_balance_before < -150`

### Rating-relative surprise

Rating brackets → `rating_factor`:

| Elo range | Factor |
|-----------|--------|
| 0–1100 | 0.4 |
| 1100–1500 | 0.3 |
| 1500–1900 | 0.2 |
| 1900–2300 | 0.1 |
| 2300–2700 | 0.05 |
| 2700+ | 0.01 |

Sacrifice type multipliers:

```
queen_sacrifice=2.5  exchange_sacrifice=1.8  real_sacrifice=1.6
positional_piece_placement=2.0  tactical_sacrifice=1.2  pseudo_sacrifice=0.8
```

```
base_surprise = min(rank_at_d8, 10) / 10
ev_bonus = ev_score × 0.15
surprise = min(10, (base_surprise + rating_factor + ev_bonus) × type_mult × 5)
p_find = max(0.001, 1 - surprise/10)
info_surprise_bits = -log2(p_find)
brilliant_for_rating = surprise > 6.0
```

### Practical brilliance

```
obj_quality = clamp((deep_eval_mover + 200) / 400, 0, 1)
practical_value = defense_difficulty × min(tm_score, 20) / 20
tal_zone = (-200 <= deep_eval_mover < -30)

if is_sound:
  pb_score = obj_quality × defense_difficulty × 10     → objective_brilliant
elif tal_zone AND defense_difficulty > 0.7:
  pb_score = practical_value × 7                       → practical_brilliant
else:
  pb_score = practical_value × 3                       → speculative_sacrifice
```

### Defensive brilliance (when is_defending)

```
is_losing = pre_move_eval < -150cp
perpetual save: +8.0   stalemate trap: +9.0   fortress draw: +5.0
clearly losing (<-400): +2.0   rescue_bonus = min(3, eval_rescue/200)
is_defensive_brilliant = defensive_score >= 6.0
```

Detectors: `detect_perpetual_check()`, `detect_stalemate_trap()` (board search).

### Archetype assignment

Priority order:
1. Quiet non-check → `quiet_masterstroke` / `endgame_revelation`
2. Defensive → `defensive_brilliance` (+ specific defensive archetypes)
3. Queen sac + king safety drop → `thunderbolt`
4. Exchange sac → `strategic_masterstroke`
5. Check + king safety → `ignition`
6. Endgame → `endgame_coup`
7. Default → `masterstroke`

### Final brilliance score

```
brilliance = non_obvious×0.30 + surprise×0.25 + pb_score×0.20
           + defense_difficulty×10×0.10 + tm_score×0.10 + ev_score×0.05

if quiet_score > 2.0:  brilliance += (quiet_score/10)×2.0
if is_defensive:      brilliance += min(material_deficit,500)/500×2.0
if defensive_score >= 6.0: brilliance += defensive_score×0.15
```

### Final classification

| Condition | Label |
|-----------|-------|
| `brilliance >= 6.5` AND `is_sound` | **BRILLIANT** |
| `brilliance >= 5.0` OR `defensive_score >= 6.0` | `practical_brilliant` |
| `brilliance >= 3.5` | `great_sacrifice` |
| else | `good_sacrifice` |

---

## 8. Frontend

### Main panel

**`frontend/src/components/BrillianceStagesPanel.jsx`**

- Tabs: Stage 0–4
- Loads cached stage snapshots via `GET /api/lichess-pgns/games/:id/stageN`
- Auto-runs pipeline via `POST .../brilliance/run` if not complete
- **Rerun all stages** button → `{ force: true }`
- Syncs eval data to parent via `onEngineEvalChange`

### Per-stage panels

| Panel | Shows |
|-------|-------|
| `StageZeroPanel` | All moves: SEE, TM, EV, harmony, →S1, →S2 flags |
| `StageOnePanel` | Sacrifice candidates: type, disqualifiers, forced, →S2 |
| `StageTwoPanel` | Shallow engine: CPL, EPΔ, rank, response width, gate fail |
| `StageThreePanel` | Deep curve, sound, rank jump, non-obvious score |
| `StageFourPanel` | Surprise, pb_score, archetype, classification, brilliance score |

### Standard move classification (separate from brilliance pipeline)

**`frontend/src/utils/moveClassification.js`** — used in analysis UI (CPL from engine eval):

| Label | CPL (pawns) |
|-------|-------------|
| Best | ≤ 0 |
| Excellent | < 0.5 (50cp) |
| Good | < 1.0 (100cp) |
| Inaccuracy | < 3.0 (300cp) |
| Mistake | < 5.0 (500cp) |
| Blunder | ≥ 5.0 |

Also used in: `playedMoveClassification.js`, `RightSidebar.jsx`, `Analyze.jsx`.

---

## 9. Backend API Routes

**File:** `backend/routes/lichessPgns.js`

| Method | Endpoint | Action |
|--------|----------|--------|
| GET | `/api/lichess-pgns/games/:gameId/stage0` | Stage 0 features |
| POST | `/api/lichess-pgns/games/:gameId/stage0/run` | Run Stage 0 |
| GET/POST | `.../stage1`, `stage1/run` | Stage 1 |
| GET/POST | `.../stage2`, `stage2/run` | Stage 2 |
| GET/POST | `.../stage3`, `stage3/run` | Stage 3 |
| GET/POST | `.../stage4`, `stage4/run` | Stage 4 |
| POST | `/api/lichess-pgns/games/:gameId/brilliance/run` | Full pipeline S0→S4 |
| GET | `/api/lichess-pgns/brilliance/analytics` | Bulk stats |
| POST | `/api/lichess-pgns/brilliance/bulk-run` | Batch processing |

### Pipeline orchestration

**`backend/services/brilliancePipelineService.js`**
```
runStage0 → runStage1 → runStage2 → runStage3 → runStage4
```

Each stage service:
1. Checks cache (`status=completed`, `features_saved > 0`) unless `force=true`
2. Sets game status `running`
3. Spawns Python via `execFile`
4. Saves rows to stage table + updates game summary columns
5. Sets `completed` or `failed`

### Bulk processing

**`backend/services/brillianceBulkService.js`** — parallel workers:
- CPU stages (0,1,4): multiple games concurrently
- Stockfish stages (2,3): limited workers to avoid engine contention

---

## 10. Database Schema

### Game-level status (`lichess_pgn_games`)

Per stage: `{stageN}_status`, `{stageN}_run_at`, `{stageN}_error`, plus counters:
- `stage0_sacrifice_count`
- `stage1_candidate_count`, `stage1_valid_count`, `stage1_proceed_stage2_count`
- `stage2_analyzed_count`, `stage2_proceed_stage3_count`
- `stage3_analyzed_count`, `stage3_sound_count`
- `stage4_analyzed_count`, `stage4_brilliant_count`

Status enum: `pending | running | completed | failed`

### Per-move tables

Each stage table: `(game_id, ply_index)` unique, FK to `lichess_pgn_moves`, plus `features_json` full Python output.

Key indexed filters:
- `stage0.is_sacrifice_candidate`
- `stage1.proceed_to_stage2`
- `stage2.proceed_to_stage3`
- `stage3.is_sound`
- `stage4.is_brilliant`

**Schema source:** `backend/db/schema.sql` (migrations in `backend/db/database.js`)

---

## 11. Python ↔ Node Invocation

Each stage script CLI:
```bash
python brilliance_stageN.py '<JSON payload>'
```

| Stage | JSON input | JSON output |
|-------|------------|-------------|
| 0,1,2 | `{ "pgn": "...", "engine_path": "..." }` | `{ moves: [...], counts... }` |
| 3 | `{ "pgn", "engine_path", "ply_indices": [14, ...] }` | filtered moves |
| 4 | `{ "moves": [ {...inputs per move} ] }` | classifications |

Node tries: `python` → `py -3` → `python3`.

---

## 12. File Index

### Python
| File | Role |
|------|------|
| `brilliance_stage0.py` | Board features, SEE, TM, EV, quiet/defensive detectors |
| `brilliance_stage1.py` | Sacrifice classification, forced filter |
| `brilliance_stage2.py` | Shallow Stockfish, Stage 2 gates |
| `brilliance_stage3.py` | Deep Stockfish, depth curve |
| `brilliance_stage4.py` | Human model, classification |
| `brilliance_gates.py` | Cascade gate logic (`resolve_engine_candidate`) |
| `brilliance_eval.py` | Shared cp/EP/CPL helpers |

### Node services
| File | Role |
|------|------|
| `brillianceStage0Service.js` … `brillianceStage4Service.js` | Per-stage run/save/fetch |
| `brilliancePipelineService.js` | Full pipeline |
| `brillianceBulkService.js` | Batch + analytics |

### Frontend
| File | Role |
|------|------|
| `BrillianceStagesPanel.jsx` | Tab container + rerun |
| `StageZeroPanel.jsx` … `StageFourPanel.jsx` | Stage UI tables |
| `BrillianceAnalyticsBar.jsx` | Bulk pipeline stats |
| `moveClassification.js` | Standard CPL labels |

### Test
| File | Role |
|------|------|
| `backend/scripts/test-brilliance-pipeline.js` | End-to-end smoke test |

---

## 13. Gate Summary (Quick Reference)

```
ALL MOVES
  └─[S0: is_sacrifice_candidate?]─→ Stage 1
        └─[S1: valid_sacrifice AND NOT forced]─→ Stage 2 (Stockfish d12)
              └─[S2: CPL≤300 AND EP_pre<0.80 AND EPΔ≥-0.15 AND NOT forced_engine]─→ Stage 3 (Stockfish d25)
                    └─[S3: proceed_to_stage4]─→ Stage 4 (human model)
                          └─[S4: brilliance≥6.5 AND is_sound]─→ BRILLIANT
```

---

## 14. Design Notes & Part 2 Extensions

The Part 2 reference describes **parallel engine branches** for quiet moves (`quiet_score > 3`) and defensive positions (`material_deficit > 150`). These detectors exist in `brilliance_stage0.py` and inform Stage 4 scoring, but **do not bypass Stage 1** in the current strict cascade implementation (`brilliance_gates.py`).

Helper functions `defensive_engine_candidate()` and `_parallel_candidate()` remain in `brilliance_gates.py` for potential future Part 2 integration but are unused by `resolve_engine_candidate()`.

---

*Generated from codebase state: strict input-layer cascade, game 202 verified 35 → 4 → 3 → 1 → 1 → 1 classified.*
