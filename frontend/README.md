# Exhaustive Chess Move Analysis - Data Inputs README

This README provides a comprehensive overview of the exhaustive data set collected for each move in the chess analysis system. This data powers the behavioral insights, machine learning models, and categorized move commentary.

## Comprehensive Move Data
For every move, the system captures and aggregates variables across several key domains:

### 1. Engine & Quality
- Real-time Stockfish evaluations and centipawn loss (delta).
- Quality classifications (Blunder to Best) and move rankings (Standing).
- Win probability and legal move counts.

### 2. Behavioral % Change & Timing
- Move duration (Tᵢ) and psychological traits.
- Categorized scores for Precision, Aggression, Resilience, Time Management, and Tactical Awareness.
- Percentage-based change tracking across moves.

### 3. Strategic Pipeline (T1-T16)
- Deep position metrics including spatial dominance, material advantage, and king safety.
- Structural analysis (pawn islands, doubled pawns) and mobility freedom.
- Tactical motifs (pins, forks, hanging pieces) and strategic synthesis.

### 4. Metadata & Book
- Full PGN metadata (players, ratings, event details).
- Opening book identification and formal nomenclature.

## Usage in Commentary Inputs
The "Commentary Generation Inputs (Exhaustive)" dashboard provides a categorized, real-time view of this data. All variables are stored in an aggregated `allMoveInputs` array for use by downstream ML models and text generation.

For the full variable list, see `MOVE_INPUTS_DOCUMENTATION.md`.
