import io
import chess
import chess.pgn
from brilliance_stage0 import is_sacrifice_candidate, piece_hanging_status, analyze_sacrifice_exposure, _enemy_compensation_from_move

pgn = """1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 g6 5. Nc3 Bg7 6. Nxc6 bxc6
7. Bd2 Nf6 8. Bd3 O-O 9. O-O a5 10. Qf3 d6 11. Rfe1 Bg4 12. Qe3 c5
13. h3 Bd7 14. e5 dxe5 15. Qxe5 Re8 16. Qxc5 Rc8 17. Qa3 e5 18. Ne4 Nxe4
19. Bxe4 a4 20. Bb7 Rxc2 21. Bc3 Bf8 22. b4 Bf5 23. g4 Qh4 24. Rf1 Bxg4
25. hxg4 Qxg4+ 26. Bg2 h5"""

g = chess.pgn.read_game(io.StringIO(pgn))
b = g.board()
for m in g.mainline_moves():
    b.push(m)

move = chess.Move.from_uci("a3a4")
c3 = chess.C3
before = piece_hanging_status(b, c3, chess.WHITE)
ba = b.copy()
ba.push(move)
after = piece_hanging_status(ba, c3, chess.WHITE)
r = is_sacrifice_candidate(b, move, chess.WHITE)
exp = analyze_sacrifice_exposure(b, move, chess.WHITE)
comp = _enemy_compensation_from_move(b, ba, move, chess.WHITE)
print("compensation:", comp)
print("exposure:", {k: exp[k] for k in exp if not k.startswith('_')})

print("Bc3 BEFORE:", before)
print("Bc3 AFTER:", after)
print()
keys = [
    "is_sacrifice_candidate", "hanging_sacrifice", "defender_removal_sacrifice",
    "defender_removed", "newly_exposed_piece_type", "newly_exposed_piece_square",
    "pre_move_defenders", "post_move_defenders", "pre_move_see", "post_move_see",
]
print("Flags:", {k: r[k] for k in keys})
print("favorable_trade:", r.get("favorable_trade"), "comp:", r.get("compensation_piece_type"), "@", r.get("compensation_piece_square"))
print()
print("After Qa4 - Re8 attacked by white:", ba.is_attacked_by(chess.WHITE, chess.E8))
print("Rc2 attacked:", ba.is_attacked_by(chess.WHITE, chess.C2))
print("a4 attacks c2:", chess.C2 in ba.attacks(move.to_square))
print("a4 attacks e8:", chess.E8 in ba.attacks(move.to_square))
new_attacks = ba.attacks(move.to_square) - b.attacks(move.from_square)
print("new attack squares on enemy:",
      [chess.square_name(s) for s in new_attacks
       if ba.piece_at(s) and ba.piece_at(s).color == chess.BLACK])
