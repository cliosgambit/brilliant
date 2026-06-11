import sys
import json
import chess
from collections import defaultdict, Counter

# --- TABLE HELPERS ---

def get_pawn_structure(board, color):
    pawns = [sq for sq, p in board.piece_map().items() if p.piece_type == chess.PAWN and p.color == color]
    files = defaultdict(list)
    for sq in pawns:
        files[chess.square_file(sq)].append(sq)
    doubled = [f for f in files if len(files[f]) > 1]
    isolated = []
    for f in files:
        if f-1 not in files and f+1 not in files:
            isolated.extend(files[f])
    
    # Connected pawns (chains)
    connected = []
    for sq in pawns:
        for df in [-1, 1]:
            adj_file = chess.square_file(sq) + df
            adj_rank = chess.square_rank(sq) - 1 if color == chess.WHITE else chess.square_rank(sq) + 1
            if 0 <= adj_file <= 7 and 0 <= adj_rank <= 7:
                adj_sq = chess.square(adj_file, adj_rank)
                if adj_sq in pawns:
                    connected.append((chess.square_name(sq), chess.square_name(adj_sq)))

    return {
        "doubled": doubled, 
        "isolated": [chess.square_name(sq) for sq in isolated], 
        "count": len(pawns),
        "connected": connected,
        "islands": len(get_pawn_islands(files))
    }

def get_pawn_islands(files_dict):
    sorted_files = sorted(files_dict.keys())
    if not sorted_files: return []
    islands = []
    current = [sorted_files[0]]
    for f in sorted_files[1:]:
        if f == current[-1] + 1:
            current.append(f)
        else:
            islands.append(current)
            current = [f]
    islands.append(current)
    return islands

def analyze_king(board, color):
    enemy = not color
    king_sq = board.king(color)
    if king_sq is None:
        return {"king_square": "None", "attack_intensity": 0, "error": "King not found"}
    
    f0, r0 = chess.square_file(king_sq), chess.square_rank(king_sq)
    zone = []
    for df in [-1, 0, 1]:
        for dr in [-1, 0, 1]:
            if 0 <= f0+df <= 7 and 0 <= r0+dr <= 7:
                zone.append(chess.square(f0+df, r0+dr))
    
    attackers = set()
    for s in zone:
        for a in board.attackers(enemy, s):
            attackers.add(chess.square_name(a))
            
    # Pawn shield
    pawn_shield = []
    for sq in zone:
        p = board.piece_at(sq)
        if p and p.color == color and p.piece_type == chess.PAWN:
            pawn_shield.append(chess.square_name(sq))
            
    # Mobility must be computed from that king's side perspective.
    board_for_color = board.copy(stack=False)
    board_for_color.turn = color
    escape_squares = [
        chess.square_name(m.to_square)
        for m in board_for_color.legal_moves
        if m.from_square == king_sq
    ]
    
    return {
        "king_square": chess.square_name(king_sq), 
        "attack_intensity": len(attackers),
        "attackers": list(attackers),
        "pawn_shield_count": len(pawn_shield),
        "mobility": len(escape_squares),
        "exposure": "High" if len(pawn_shield) < 2 else "Low"
    }

def get_piece_activity(board, color):
    pieces = [(sq, p) for sq, p in board.piece_map().items() if p.color == color]
    board_for_color = board.copy(stack=False)
    board_for_color.turn = color
    total_mobility = 0
    for sq, p in pieces:
        total_mobility += len([m for m in board_for_color.legal_moves if m.from_square == sq])
    
    avg_mobility = round(total_mobility / len(pieces), 2) if pieces else 0
    return {
        "total_mobility": total_mobility,
        "avg_mobility": avg_mobility,
        "freedom": "Free" if avg_mobility > 4 else "Moderately Free" if avg_mobility > 2.5 else "Cramped"
    }

# --- TACTICAL HELPERS (SEE) ---

PIECE_VALUE = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 100
}

def get_see(board, square):
    """
    Static Exchange Evaluation for a given square.
    Returns net material gain for the side to move if capturing starts here.
    """
    gain = []
    side = board.turn

    attackers = {
        True: set(board.attackers(chess.WHITE, square)),
        False: set(board.attackers(chess.BLACK, square))
    }

    def least_valuable_attacker(color):
        candidates = attackers[color]
        if not candidates:
            return None
        # Filter out squares that no longer have the same piece (if we were simulating, but here we just use attackers set)
        return min(candidates, key=lambda sq: PIECE_VALUE[board.piece_type_at(sq)])

    target_piece = board.piece_type_at(square)
    if target_piece is None:
        return 0

    gain.append(PIECE_VALUE[target_piece])

    color = side
    i = 0

    # Simulate capture sequence
    while True:
        attacker_sq = least_valuable_attacker(color)
        if attacker_sq is None:
            break

        piece_type = board.piece_type_at(attacker_sq)
        gain.append(PIECE_VALUE[piece_type] - gain[i])
        i += 1

        attackers[color].remove(attacker_sq)
        color = not color

    # Minimax backward to find the optimal stopping point for both sides
    for j in range(len(gain)-2, -1, -1):
        gain[j] = max(-gain[j+1], gain[j])

    return gain[0]

def analyze_fen_full(fen):
    try:
        board = chess.Board(fen)
    except Exception as e:
        return {"error": f"Invalid FEN: {e}"}

    PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
    PIECE_NAMES = {chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop", chess.ROOK: "rook", chess.QUEEN: "queen", chess.KING: "king"}
    
    # --- TABLE 1: RAW & DERIVED ---
    t1 = {
        "raw": {
            "placement": fen.split()[0],
            "turn": "White" if board.turn == chess.WHITE else "Black",
            "castling": board.castling_xfen(),
            "ep": chess.square_name(board.ep_square) if board.ep_square else "None",
            "halfmove": board.halfmove_clock,
            "fullmove": board.fullmove_number
        },
        "derived": {
            "game_phase": "Opening" if board.fullmove_number <= 10 and len(board.piece_map()) >= 28 else "Endgame" if len(board.piece_map()) <= 12 else "Middlegame",
            "castling_safety": "Available" if board.castling_rights != 0 else "None"
        }
    }

    # --- TABLE 2: GEOMETRY & OCCUPANCY ---
    occupied = [chess.square_name(s) for s in board.piece_map()]
    t2 = {
        "occupied_count": len(occupied),
        "empty_count": 64 - len(occupied),
        "density": round(len(occupied) / 64, 3),
        "spatial_dominance": {
            "white": len([s for s in chess.SQUARES if board.attackers(chess.WHITE, s) and not board.attackers(chess.BLACK, s)]),
            "black": len([s for s in chess.SQUARES if board.attackers(chess.BLACK, s) and not board.attackers(chess.WHITE, s)])
        }
    }

    # --- TABLE 3: MATERIAL ---
    white_mat = sum(PIECE_VALUES[p.piece_type] for p in board.piece_map().values() if p.color == chess.WHITE)
    black_mat = sum(PIECE_VALUES[p.piece_type] for p in board.piece_map().values() if p.color == chess.BLACK)
    t3 = {
        "white": white_mat,
        "black": black_mat,
        "advantage": white_mat - black_mat,
        "simplification": "Complex" if len(board.piece_map()) > 20 else "Simplified"
    }

    # --- TABLE 4: TACTICS & WEAKNESSES (SEE-based) ---
    see_results = []
    loose_pieces = []
    
    for sq, p in board.piece_map().items():
        attackers = board.attackers(not p.color, sq)
        defenders = board.attackers(p.color, sq)
        
        # 1. Check for loose pieces (no defenders, regardless of attackers)
        if len(defenders) == 0:
            loose_pieces.append(f"{PIECE_NAMES[p.piece_type]}: {chess.square_name(sq)}")
            
        # 2. Check for squares where the piece is losing material (SEE < 0)
        # We simulate the opponent capturing the piece starting now.
        if attackers:
            # We temporarily set the turn to the opponent to see if they can win material on this square.
            board.turn = not p.color
            see_val = get_see(board, sq)
            board.turn = not board.turn # reset turn
            
            if see_val > 0: # This means the attacker (opponent) gains material
                see_results.append({
                    "square": chess.square_name(sq),
                    "piece": PIECE_NAMES[p.piece_type],
                    "color": "white" if p.color == chess.WHITE else "black",
                    "see": -see_val # Express as loss for the owner
                })
            
    t4 = {
        "see_losses": see_results, 
        "loose": loose_pieces
    }

    # --- TABLE 5: KING SAFETY ---
    t5 = {
        "white": analyze_king(board, chess.WHITE),
        "black": analyze_king(board, chess.BLACK)
    }

    # --- TABLE 6: PAWN STRUCTURE ---
    t6 = {
        "white": get_pawn_structure(board, chess.WHITE),
        "black": get_pawn_structure(board, chess.BLACK)
    }

    # --- TABLE 7: ACTIVITY & MOBILITY ---
    t7 = {
        "white": get_piece_activity(board, chess.WHITE),
        "black": get_piece_activity(board, chess.BLACK),
        "legal_moves": [m.uci() for m in board.legal_moves]
    }

    # --- TABLE 8: SPACE ADVANTAGE ---
    white_space = len([s for s in chess.SQUARES if board.attackers(chess.WHITE, s)])
    black_space = len([s for s in chess.SQUARES if board.attackers(chess.BLACK, s)])
    t8 = {
        "white_controlled": white_space,
        "black_controlled": black_space,
        "ratio": round(white_space / black_space, 2) if black_space > 0 else 1.0
    }

    # --- TABLE 9: TACTICAL PATTERNS (PINS/FORKS) ---
    pins = []
    forks = []
    for sq, p in board.piece_map().items():
        p_name = PIECE_NAMES[p.piece_type]
        if board.is_pinned(p.color, sq):
            pins.append(f"{p_name}: {chess.square_name(sq)}")
        
        # Simple fork detection (attacking more than 1 valuable piece)
        attacks = board.attacks(sq)
        valuable_attacks = [s for s in attacks if board.piece_at(s) and board.piece_at(s).color != p.color and PIECE_VALUES[board.piece_at(s).piece_type] > 1]
        if len(valuable_attacks) > 1:
            forks.append(f"{p_name}: {chess.square_name(sq)}")
            
    t9 = {"pins": pins, "forks": forks}

    # --- TABLE 10: INITIATIVE & THREATS ---
    t10 = {
        "has_initiative": "White" if board.turn == chess.WHITE else "Black",
        "is_check": board.is_check(),
        "complexity": "High" if len(list(board.legal_moves)) > 40 else "Moderate"
    }

    # --- TABLE 11: CAPTURE DETECTION ---
    captures = []
    for move in board.legal_moves:
        if board.is_capture(move):
            target_piece = board.piece_at(move.to_square)
            moved_piece = board.piece_at(move.from_square)
            if target_piece and moved_piece:
                capture_desc = f"{PIECE_NAMES[moved_piece.piece_type]}x{PIECE_NAMES[target_piece.piece_type]} on {chess.square_name(move.to_square)}"
                captures.append(capture_desc)

    t11 = {"captures": captures[:10]}

    # --- TABLE 13: GAME PHASE ---
    t13 = {
        "phase": t1["derived"]["game_phase"],
        "endgame_proximity": "Already in endgame" if t1["derived"]["game_phase"] == "Endgame" else "Approaching" if len(board.piece_map()) < 18 else "Far"
    }

    # --- TABLE 15: POSITION QUALITY ---
    t15 = {
        "white": {
            "practical_risk": "High" if t5["white"]["attack_intensity"] > 2 else "Low",
            "ease_of_play": t7["white"]["freedom"]
        },
        "black": {
            "practical_risk": "High" if t5["black"]["attack_intensity"] > 2 else "Low",
            "ease_of_play": t7["black"]["freedom"]
        }
    }

    # --- TABLE 16: STRATEGIC SYNTHESIS ---
    t16 = {
        "overall": "White better" if t3["advantage"] > 2 else "Black better" if t3["advantage"] < -2 else "Equal",
        "winning_plan": "Simplify" if t3["advantage"] != 0 else "Create Imbalance"
    }

    # --- BOARD STATE SUMMARY ---
    # These fields are added to the top-level of the JSON as requested.
    board_state = {
        "game_phase": t13["phase"],
        "tactical_classification": "Active" if (t9["pins"] or t9["forks"] or t4["see_losses"]) else "NONE",
        "king_safety": "Safe" if (t15["white"]["practical_risk"] == "Low" and t15["black"]["practical_risk"] == "Low") else "Critical",
        "space_dominance": "White slightly better" if t8["ratio"] > 1.1 else "Black slightly better" if t8["ratio"] < 0.9 else "Equal",
        "mobility": "Normal" if 2.5 <= t7["white"]["avg_mobility"] <= 4 else "High" if t7["white"]["avg_mobility"] > 4 else "Low"
    }

    return {
        **board_state,
        "tables": {
            "t1": t1, "t2": t2, "t3": t3, "t4": t4, "t5": t5, "t6": t6, "t7": t7, "t8": t8, "t9": t9,
            "t10": t10, "t11": t11, "t13": t13, "t15": t15, "t16": t16
        }
    }

if __name__ == "__main__":
    # Persistent loop mode
    for line in sys.stdin:
        if not line.strip(): continue
        try:
            req = json.loads(line)
            fen = req.get("fen")
            if not fen:
                print(json.dumps({"error": "No FEN provided"}))
                continue
            analysis = analyze_fen_full(fen)
            print(json.dumps(analysis))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.stdout.flush()
