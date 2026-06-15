import io
import chess
import chess.pgn
from brilliance_stage0 import is_sacrifice_candidate, analyze_sacrifice_exposure

def run(label, fen_or_pgn, move_uci, color, *, from_pgn=False):
    if from_pgn:
        g = chess.pgn.read_game(io.StringIO(fen_or_pgn))
        b = g.board()
        for m in g.mainline_moves():
            b.push(m)
    else:
        b = chess.Board(fen_or_pgn)
    move = chess.Move.from_uci(move_uci)
    r = is_sacrifice_candidate(b, move, color)
    exp = analyze_sacrifice_exposure(b, move, color)
    print(
        label,
        "sac=", r["is_sacrifice_candidate"],
        "favorable=", r.get("favorable_trade"),
        "see=", exp.get("pre_move_see"), "->", exp.get("post_move_see"),
        "def=", exp.get("pre_move_defenders"), "->", exp.get("post_move_defenders"),
        "became_lost=", exp.get("became_lost") if "became_lost" in exp else "n/a",
        "exposed=", exp.get("exposed_piece_type"), "@", exp.get("exposed_piece_square"),
    )

PGN = """1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 g6 5. Nc3 Bg7 6. Nxc6 bxc6
7. Bd2 Nf6 8. Bd3 O-O 9. O-O a5 10. Qf3 d6 11. Rfe1 Bg4 12. Qe3 c5
13. h3 Bd7 14. e5 dxe5 15. Qxe5 Re8 16. Qxc5 Rc8 17. Qa3 e5 18. Ne4 Nxe4
19. Bxe4 a4 20. Bb7 Rxc2 21. Bc3 Bf8 22. b4 Bf5 23. g4 Qh4 24. Rf1 Bxg4
25. hxg4 Qxg4+ 26. Bg2 h5"""

run("Qa4 fork", PGN, "a3a4", chess.WHITE, from_pgn=True)

pgn2 = PGN.split("23. g4")[0] + "23. g4"
run("Qh4", pgn2, "d8h4", chess.BLACK, from_pgn=True)

run("Qd1 bishop", "2r1k3/8/8/8/2B5/8/4Q3/4K3 w - - 0 1", "e2d1", chess.WHITE)

run("Ra8 knight", "1b2k3/8/8/8/8/RN6/2b5/4K3 w - - 0 1", "a3a8", chess.WHITE)
