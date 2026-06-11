# Commentary Grammar System - All Possible Outputs

This document lists every possible sentence variation for each grammar block in the deterministic chess commentary system.

## 1. Phase Context ([PHASE_CONTEXT])
*Derived from `game_phase`*
- **Opening**: "In the opening,"
- **Middlegame**: "In the middlegame,"
- **Endgame**: "In the endgame,"
- **Default**: "In this position,"

## 2. Move Action ([MOVE_ACTION])
*Derived from `turn`, `san_move`, `english_move`, and `book_move_name`*
- **Format (Standard)**: "{turn} played {san_move} ({english_move})."
- **Format (Book Move)**: "{turn} played {san_move} ({english_move}), which is part of the {book_move_name}."
- **Examples**:
    - "White played Qxd4 (Queen takes pawn on d4)."
    - "Black played Nf6 (Knight to f6), which is part of the Ruy Lopez: Berlin Defense."

## 3. Move Quality ([MOVE_QUALITY])
*Derived from `classification`*
- **Best**: "This was the best move."
- **Excellent**: "This was an excellent move."
- **Good**: "This was a good move."
- **Inaccuracy**: "This was a slight inaccuracy."
- **Mistake**: "This was a mistake."
- **Blunder**: "This was a serious blunder."

## 4. Tactical Result ([TACTICAL_RESULT])
*Derived from `tactical_classification`*
- **WINNING MOVE / FAVORABLE TRADE**: "It still led to a favorable trade."
- **TACTICAL SHOT**: "It created a tactical opportunity."
- **MISS**: "It missed a tactical opportunity."
- **FORCING MOVE**: "It applied immediate pressure."
- **SACRIFICE (Intentional)**: "It was a daring sacrifice to create dynamic play."
- **BLUNDER (Losing Material)**: "It unfortunately loses material for nothing."
- **HANGING / LOSING (-X)**: "It leaves the piece hanging."
- **EQUAL TRADE**: "It resulted in an equal exchange."
- **None**: "" (No tactical summary)

## 5. Better Alternative ([BETTER_ALTERNATIVE])
*Derived from `best_engine` and `classification`*
- **Best move**: "No better alternative was found."
- **Otherwise**: "However, {best_engine} was a stronger continuation."

## 5b. Future Impact ([FUTURE_IMPACT])
*Derived from `top_3_next_moves`*
- **Strongest Response**: "The engine recommends {move} as the strongest response, leading to a position evaluated at {eval}." (Used when played move was not best)
- **Board State Prediction**: The JSON now includes `predicted_board_state` (FEN) for each of the top 3 next moves.

## 6. Position Summary ([POSITION_SUMMARY])
*Aggregated from Contextual and Strategic Signals, including evaluation impact*
- **Material & Impact**:
    - "Material remained equal."
    - "Material remained equal, but {White/Black} is now significantly better due to the positional impact." (Used when eval > 1.5 but material is equal)
    - "White held a material advantage."
    - "Black held a material advantage."
- **King Safety**:
    - "The king remained safe."
    - "The king became slightly exposed."
    - "The king was left vulnerable."
- **Space Dominance**:
    - "White maintained significant board control."
    - "White kept a slight space advantage."
    - "Black dominated the board space."
    - "Black kept a slight space advantage."
    - "Space remained balanced."
- **Mobility**:
    - "White's pieces were extremely active."
    - "White had better piece activity."
    - "Black's pieces were extremely active."
    - "Black had better piece activity."
    - "Piece mobility remained normal."

## 7. Coaching Hint ([COACHING_HINT])
*Derived from combinations of quality and tactical results*
- **Best/Excellent**: "Excellent calculation and understanding of the position."
- **Good**: "This was a solid decision that kept the position comfortable."
- **Inaccuracy + Favorable Trade**: "The idea was reasonable, but comparing alternatives could have found a more accurate move."
- **Mistake + Missed Tactic**: "Look for tactical opportunities before committing to the move."
- **Blunder + Unsafe King**: "Prioritize king safety and calculate forcing responses more carefully."
- **Mistake/Blunder (General)**: "Try to evaluate the position more carefully before committing."
