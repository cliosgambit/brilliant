# Redefined Chess Move Analysis Inputs Documentation

This document defines the final set of input variables used for generating move commentary in the "Commentary Generation Inputs (Exhaustive)" dashboard.

## 1. Identity
- `san_move`: The move played in Standard Algebraic Notation (e.g., `d4`).
- `turn`: The side that made the move ("White" or "Black").

## 2. Evaluation (Impact)
- `played_move_classification`: Quality label (e.g., `book`, `best`, `blunder`).
- `played_move_eval`: Engine evaluation after the move (e.g., `+0.37`).
- `eval_before_move`: Engine evaluation before the move (e.g., `+0.47`).
- `move_quality_delta`: Change in evaluation (e.g., `-0.10`).
- `best_engine_move`: Top recommended move and its evaluation (e.g., `e4 (+0.43)`).
- `win_probability`: Calculated win chance for the active side (e.g., `53.6%`).

## 3. Context
- `game_phase`: Current phase of the game (`Opening`, `Middlegame`, `Endgame`).
- `material_balance`: Semantic material state (e.g., `Equal`, `White +3`).
- `legal_moves`: Total number of legal moves available in the position.
- `move_standing`: Rank of the played move among engine choices (e.g., `#2`).

## 4. Tactical Signals
- `tactical_classification`: Rigorous classification of the move played (`BLUNDER`, `SACRIFICE`, `HANGING`, `TRADE`, `WINNING MOVE`, or `None`). Uses SEE (Static Exchange Evaluation) + Eval context.
- `hanging_pieces`: Other pieces currently losing material according to SEE (excluding the move played).
- `loose_pieces`: Pieces with 0 defenders (regardless of attackers).
- `king_safety`: Semantic safety level (`Safe`, `Exposed`, `Critical`).

## 5. Strategic Signals
- `space_dominance`: Semantic description of board control (e.g., `White slightly better`).
- `mobility`: Activity level of pieces (e.g., `Normal`, `White very active`).
