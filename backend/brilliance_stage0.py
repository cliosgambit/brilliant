"""
Brilliance Engine — Stage 0 board-only feature extraction.
Runs on every move with zero engine calls (python-chess only).
"""
import io
import json
import sys

import chess
import chess.pgn

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 305,
    chess.BISHOP: 333,
    chess.ROOK: 563,
    chess.QUEEN: 950,
    chess.KING: 0,
}

PIECE_NAMES = {
    chess.PAWN: "pawn",
    chess.KNIGHT: "knight",
    chess.BISHOP: "bishop",
    chess.ROOK: "rook",
    chess.QUEEN: "queen",
    chess.KING: "king",
}


def material_count(board, color):
    return sum(
        PIECE_VALUES[pt] * len(board.pieces(pt, color))
        for pt in PIECE_VALUES
        if pt != chess.KING
    )


def material_balance(board, color):
    return material_count(board, color) - material_count(board, not color)


def game_phase(board):
    total = sum(
        PIECE_VALUES.get(pt, 0) * len(board.pieces(pt, c))
        for pt in [chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT]
        for c in [chess.WHITE, chess.BLACK]
    )
    if total > 5800:
        return "opening"
    if total > 2800:
        return "middlegame"
    return "endgame"


def game_phase_code(phase):
    return {"opening": 0, "middlegame": 1, "endgame": 2}.get(phase, 1)


def see(board, move):
    to_sq = move.to_square
    from_sq = move.from_square
    captured = board.piece_at(to_sq)
    moving_piece = board.piece_at(from_sq)

    if captured is None or moving_piece is None:
        return 0

    gain = [PIECE_VALUES.get(captured.piece_type, 0)]
    b = board.copy()
    b.push(move)

    def lva(b2, sq, color):
        min_val, best_m = float("inf"), None
        for m in b2.legal_moves:
            if m.to_square == sq:
                p = b2.piece_at(m.from_square)
                if p and p.color == color:
                    v = PIECE_VALUES.get(p.piece_type, 0)
                    if v < min_val:
                        min_val, best_m = v, m
        return best_m, min_val

    depth = 0
    while depth < 8:
        opp_color = b.turn
        m, _attacker_val = lva(b, to_sq, opp_color)
        if m is None:
            break
        piece_on_sq = b.piece_at(to_sq)
        gain.append(PIECE_VALUES.get(piece_on_sq.piece_type, 0) if piece_on_sq else 0)
        b.push(m)
        depth += 1

    result = 0
    for i in range(len(gain) - 1, -1, -1):
        result = gain[i] - max(0, result)
    return result


INDIRECT_SACRIFICE_MIN_VALUE = 300
OPP_PROFITABLE_SEE_THRESHOLD = 50


def _remaining_defender_value(board, square, color):
    total = 0
    for def_sq in board.attackers(color, square):
        p = board.piece_at(def_sq)
        if p and p.color == color:
            total += PIECE_VALUES.get(p.piece_type, 0)
    return total


def _is_insufficiently_defended(board, square, color):
    opp = not color
    attackers = board.attackers(opp, square)
    if not attackers:
        return False
    defenders = board.attackers(color, square)
    if len(defenders) == 0:
        return True
    return len(defenders) < len(attackers)


def _pieces_defended_by_square(board, defender_sq, color):
    """Friendly non-king pieces where defender_sq is one of their defenders."""
    defended = []
    for sq in chess.SQUARES:
        if sq == defender_sq:
            continue
        piece = board.piece_at(sq)
        if not piece or piece.color != color or piece.piece_type == chess.KING:
            continue
        if defender_sq in board.attackers(color, sq):
            defended.append(sq)
    return defended


def _indirect_sacrifice_empty():
    return {
        "indirect_sacrifice_candidate": False,
        "exposed_piece_square": None,
        "exposed_piece_type": None,
        "exposed_piece_value": 0,
        "defender_removed_by_move": False,
        "sacrifice_risk": 0,
        "remaining_defender_value": 0,
        "opponent_profitable_capture_exists": False,
        "safe_escapes_before": 0,
        "safe_escapes_after": 0,
    }


def _evaluate_indirect_exposure(
    board_after,
    sq,
    color,
    *,
    defender_removed,
    safe_escapes_before=None,
    safe_escapes_after=None,
):
    """Build exposure record if square qualifies as indirectly sacrificed."""
    piece = board_after.piece_at(sq)
    if not piece or piece.color != color:
        return None

    piece_value = PIECE_VALUES.get(piece.piece_type, 0)
    if piece_value < INDIRECT_SACRIFICE_MIN_VALUE:
        return None

    opp = not color
    if not board_after.attackers(opp, sq):
        return None

    opp_see = opponent_capture_see(board_after, sq, color)
    opponent_profitable = opp_see > OPP_PROFITABLE_SEE_THRESHOLD
    insufficient = _is_insufficiently_defended(board_after, sq, color)
    if not opponent_profitable and not insufficient:
        return None

    remaining_def_val = _remaining_defender_value(board_after, sq, color)
    sacrifice_risk = piece_value - remaining_def_val

    exposure = {
        "exposed_piece_square": chess.square_name(sq),
        "exposed_piece_type": PIECE_NAMES.get(piece.piece_type),
        "exposed_piece_value": piece_value,
        "defender_removed_by_move": defender_removed,
        "sacrifice_risk": sacrifice_risk,
        "remaining_defender_value": remaining_def_val,
        "opponent_profitable_capture_exists": opponent_profitable,
        "opp_see_after": opp_see,
        "safe_escapes_before": safe_escapes_before if safe_escapes_before is not None else 0,
        "safe_escapes_after": safe_escapes_after if safe_escapes_after is not None else 0,
    }

    if opponent_profitable and piece_value >= INDIRECT_SACRIFICE_MIN_VALUE:
        return exposure
    return None


def detect_indirect_sacrifice(board, move, color):
    """
    Detect sacrifices where the moving piece stays safe but another valuable
    friendly piece becomes profitably capturable.

    Two paths:
    1. Remove-defender — mover was a direct defender and stops defending.
    2. Tactical exposure — mover cuts safe escapes / turns a recoverable
       piece into a lost one (e.g. Qh4 leaving Bf5 with no safe flight).
    """
    empty = _indirect_sacrifice_empty()

    from_sq = move.from_square
    to_sq = move.to_square
    moving_piece = board.piece_at(from_sq)
    if moving_piece is None or moving_piece.color != color:
        return empty

    board_after = board.copy()
    board_after.push(move)
    opp = not color

    candidates = []

    # Path 1: direct defender removed
    for sq in _pieces_defended_by_square(board, from_sq, color):
        if to_sq in board_after.attackers(color, sq):
            continue
        exposure = _evaluate_indirect_exposure(
            board_after,
            sq,
            color,
            defender_removed=True,
        )
        if exposure:
            candidates.append(exposure)

    # Path 2: tactical deterioration of a piece that was not already lost
    for sq in chess.SQUARES:
        if sq == from_sq:
            continue
        piece = board.piece_at(sq)
        if not piece or piece.color != color or piece.piece_type == chess.KING:
            continue

        vuln_before = analyze_piece_vulnerability(board, sq, color)
        if vuln_before["already_lost_before_move"]:
            continue

        piece_after = board_after.piece_at(sq)
        if not piece_after or piece_after.color != color:
            continue

        vuln_after = analyze_piece_vulnerability(board_after, sq, color)
        escapes_before = vuln_before["safe_escape_squares"]
        escapes_after = vuln_after["safe_escape_squares"]

        deteriorated = (
            vuln_after["already_lost_before_move"]
            or (escapes_before > 0 and escapes_after == 0)
            or (
                escapes_after < escapes_before
                and vuln_after["already_lost_before_move"]
            )
        )
        if not deteriorated:
            continue

        # Skip if path 1 already captured this square
        if any(c["exposed_piece_square"] == chess.square_name(sq) for c in candidates):
            continue

        exposure = _evaluate_indirect_exposure(
            board_after,
            sq,
            color,
            defender_removed=False,
            safe_escapes_before=escapes_before,
            safe_escapes_after=escapes_after,
        )
        if exposure:
            candidates.append(exposure)

    if not candidates:
        return empty

    best = max(candidates, key=lambda c: c["sacrifice_risk"])
    return {
        "indirect_sacrifice_candidate": True,
        **best,
    }


def is_sacrifice_candidate(board, move, color):
    to_sq = move.to_square
    from_sq = move.from_square
    moving_piece = board.piece_at(from_sq)
    captured = board.piece_at(to_sq)
    opp = not color
    is_capture = board.is_capture(move)

    see_val = see(board, move) if is_capture else 0

    dest_attackers = len(board.attackers(opp, to_sq))
    dest_defenders = len(board.attackers(color, to_sq))

    # Only flag positional risk if opponent PROFITS from capturing at destination
    positional_risk = False
    if not is_capture and dest_attackers > 0 and moving_piece is not None:
        board_after = board.copy()
        board_after.push(move)
        min_opp_atk = float("inf")
        best_opp_cap = None
        for atk_sq in board_after.attackers(opp, to_sq):
            ap = board_after.piece_at(atk_sq)
            if ap:
                v = PIECE_VALUES.get(ap.piece_type, 0)
                if v < min_opp_atk:
                    min_opp_atk = v
                    best_opp_cap = chess.Move(atk_sq, to_sq)
        if best_opp_cap and board_after.is_legal(best_opp_cap):
            opp_see = see(board_after, best_opp_cap)
            positional_risk = opp_see > OPP_PROFITABLE_SEE_THRESHOLD

    indirect = detect_indirect_sacrifice(board, move, color)
    negative_see_sacrifice = see_val < -100
    is_sac = negative_see_sacrifice or positional_risk or indirect["indirect_sacrifice_candidate"]

    return {
        "is_capture": is_capture,
        "see_value": see_val,
        "is_sacrifice_candidate": is_sac,
        "moving_piece_type": PIECE_NAMES.get(moving_piece.piece_type) if moving_piece else None,
        "moving_piece_value": PIECE_VALUES.get(moving_piece.piece_type, 0) if moving_piece else 0,
        "captured_value": PIECE_VALUES.get(captured.piece_type, 0) if captured else 0,
        "dest_attackers": dest_attackers,
        "dest_defenders": dest_defenders,
        "positional_risk": positional_risk,
        "negative_see_sacrifice": negative_see_sacrifice,
        "indirect_sacrifice_candidate": indirect["indirect_sacrifice_candidate"],
        "exposed_piece_square": indirect["exposed_piece_square"],
        "exposed_piece_type": indirect["exposed_piece_type"],
        "exposed_piece_value": indirect["exposed_piece_value"],
        "defender_removed_by_move": indirect["defender_removed_by_move"],
        "sacrifice_risk": indirect["sacrifice_risk"],
        "remaining_defender_value": indirect["remaining_defender_value"],
        "opponent_profitable_capture_exists": indirect["opponent_profitable_capture_exists"],
        "safe_escapes_before": indirect.get("safe_escapes_before", 0),
        "safe_escapes_after": indirect.get("safe_escapes_after", 0),
    }


# --- Piece vulnerability: en prise (local) vs already lost (global) ---

OPP_SEE_EN_PRISE_THRESHOLD = 0
SAFE_SQUARE_SEE_THRESHOLD = 0
CAPTURE_OUT_SEE_MIN = -100
MIN_ESCAPE_MOBILITY = 2


def opponent_lva_capture_move(board, square, opp):
    """Legal opponent LVA capture on square, or None (evaluated with opponent to move)."""
    b = board.copy()
    b.turn = opp
    legal_captures = [
        m
        for m in b.generate_pseudo_legal_moves()
        if m.to_square == square
        and b.piece_at(m.from_square)
        and b.piece_at(m.from_square).color == opp
        and b.is_legal(m)
    ]
    if not legal_captures:
        return None
    return min(
        legal_captures,
        key=lambda m: PIECE_VALUES.get(b.piece_at(m.from_square).piece_type, 0),
    )


def opponent_capture_see(board, square, color):
    """SEE for opponent's best legal capture on square (from our POV: positive SEE = bad for us)."""
    opp = not color
    lva = opponent_lva_capture_move(board, square, opp)
    if not lva:
        return 0
    return see(board, lva)


def is_piece_en_prise(board, square, color):
    """
    Local tactical fact: opponent has a profitable capture on this square now.
    Does NOT imply the piece is inevitably lost.
    """
    piece = board.piece_at(square)
    if not piece or piece.color != color:
        return False
    opp = not color
    if not board.attackers(opp, square):
        return False
    return opponent_capture_see(board, square, color) > OPP_SEE_EN_PRISE_THRESHOLD


def is_absolute_pin(board, square, color):
    """True if removing the piece would leave our king in check (pinned to king)."""
    if not board.is_pinned(color, square):
        return False
    b = board.copy()
    b.remove_piece_at(square)
    return b.is_check()


def count_piece_legal_moves(board, square, color):
    return sum(1 for m in board.legal_moves if m.from_square == square)


def is_safe_escape_square(board, move, color):
    """
    Escape is survivable if destination passes SEE, has defense/tactical justification,
    and leaves the piece with sufficient mobility (avoids trapped-on-safe-SEE squares).
    """
    if move.from_square == move.to_square:
        return False
    if not board.is_legal(move):
        return False

    b = board.copy()
    b.push(move)
    dest = move.to_square
    piece = b.piece_at(dest)
    if not piece or piece.color != color:
        return False

    opp = not color
    dest_opp_see = opponent_capture_see(b, dest, color)
    if dest_opp_see > SAFE_SQUARE_SEE_THRESHOLD:
        return False

    defenders = len(b.attackers(color, dest))
    attackers = len(b.attackers(opp, dest))
    tactically_justified = b.is_check() or b.is_checkmate()
    defended_or_justified = defenders > 0 or tactically_justified or attackers == 0

    mobility = count_piece_legal_moves(b, dest, color)
    if mobility < MIN_ESCAPE_MOBILITY and attackers > 0:
        return False

    if attackers > 0 and not defended_or_justified:
        return False

    return True


def has_capture_out(board, square, color):
    """Desperado / zwischenzug / liquidation — capture that is not a blunder trade."""
    for m in board.legal_moves:
        if m.from_square != square or not board.is_capture(m):
            continue
        if see(board, m) >= CAPTURE_OUT_SEE_MIN:
            return True
    return False


def analyze_piece_vulnerability(board, square, color):
    """
    Returns en_prise (tactical vulnerability) vs already_lost (heuristic inevitability).
    Only already_lost should disqualify sacrifices in Stage 1.
    """
    piece = board.piece_at(square)
    empty = {
        "en_prise_before_move": False,
        "already_lost_before_move": False,
        "safe_escape_squares": 0,
        "has_capture_out": False,
        "absolute_pin": False,
        "disqualify_reason": None,
    }
    if not piece or piece.color != color:
        return empty

    en_prise = is_piece_en_prise(board, square, color)
    safe_escapes = sum(
        1
        for m in board.legal_moves
        if m.from_square == square and is_safe_escape_square(board, m, color)
    )
    capture_out = has_capture_out(board, square, color)
    absolute_pin = is_absolute_pin(board, square, color)

    already_lost = False
    reason = None

    if en_prise:
        if safe_escapes > 0 or capture_out:
            already_lost = False
        elif absolute_pin and safe_escapes == 0 and not capture_out:
            already_lost = True
            reason = "piece_already_lost_before_move"
        elif not absolute_pin and safe_escapes == 0 and not capture_out:
            already_lost = True
            reason = "piece_already_lost_before_move"

    return {
        **empty,
        "en_prise_before_move": en_prise,
        "already_lost_before_move": already_lost,
        "safe_escape_squares": safe_escapes,
        "has_capture_out": capture_out,
        "absolute_pin": absolute_pin,
        "disqualify_reason": reason,
    }


def was_piece_hanging(board, square, color):
    """Deprecated alias — returns (already_lost, reason) for Stage 1 compatibility."""
    vuln = analyze_piece_vulnerability(board, square, color)
    if vuln["already_lost_before_move"]:
        return True, vuln.get("disqualify_reason") or "piece_already_lost_before_move"
    return False, ""


def king_safety(board, color):
    king_sq = board.king(color)
    if king_sq is None:
        return {
            "pawn_shield": 0,
            "open_files_near": 0,
            "zone_attack_score": 0,
            "castled": False,
            "total_safety": 0,
        }

    opp = not color
    kf = chess.square_file(king_sq)
    kr = chess.square_rank(king_sq)
    direction = 1 if color == chess.WHITE else -1

    pawn_shield = 0
    for df in (-1, 0, 1):
        for dr, strength in ((1, 2), (2, 1)):
            f, r = kf + df, kr + dr * direction
            if 0 <= f <= 7 and 0 <= r <= 7:
                sq = chess.square(f, r)
                p = board.piece_at(sq)
                if p and p.piece_type == chess.PAWN and p.color == color:
                    pawn_shield += strength

    open_file_penalty = 0
    for df in (-1, 0, 1):
        f = kf + df
        if 0 <= f <= 7:
            own_pawn = any(
                board.piece_at(chess.square(f, r)) == chess.Piece(chess.PAWN, color)
                for r in range(8)
            )
            opp_pawn = any(
                board.piece_at(chess.square(f, r)) == chess.Piece(chess.PAWN, opp)
                for r in range(8)
            )
            if not own_pawn and not opp_pawn:
                open_file_penalty += 3
            elif not own_pawn:
                open_file_penalty += 1

    attack_weights = {
        chess.QUEEN: 5,
        chess.ROOK: 3,
        chess.BISHOP: 2,
        chess.KNIGHT: 2,
    }
    king_zone_attack = 0
    for df in range(-2, 3):
        for dr in range(-2, 3):
            f, r = kf + df, kr + dr
            if 0 <= f <= 7 and 0 <= r <= 7:
                zone_sq = chess.square(f, r)
                for pt, w in attack_weights.items():
                    if board.is_attacked_by(opp, zone_sq):
                        king_zone_attack += w
                        break

    if_castled = king_sq in (
        {chess.G1, chess.C1} if color == chess.WHITE else {chess.G8, chess.C8}
    )

    total = (pawn_shield * 10) - (open_file_penalty * 15) - (king_zone_attack * 5)

    return {
        "pawn_shield": pawn_shield,
        "open_files_near": open_file_penalty,
        "zone_attack_score": king_zone_attack,
        "castled": if_castled,
        "total_safety": total,
    }


def tactical_multiplexing(board_before, board_after, color):
    opp = not color

    def attacked_enemy_pieces(b):
        attacked = {}
        for sq in chess.SQUARES:
            p = b.piece_at(sq)
            if p and p.color == opp and p.piece_type != chess.KING:
                if b.is_attacked_by(color, sq):
                    attacked[sq] = {
                        "value": PIECE_VALUES.get(p.piece_type, 0),
                        "undefended": len(b.attackers(opp, sq)) == 0,
                    }
        return attacked

    before_atk = attacked_enemy_pieces(board_before)
    after_atk = attacked_enemy_pieces(board_after)
    new_attacks = {sq: d for sq, d in after_atk.items() if sq not in before_atk}
    new_hanging = [d for d in new_attacks.values() if d["undefended"]]

    def forks(b):
        result = []
        for piece_sq in chess.SQUARES:
            atk = b.piece_at(piece_sq)
            if not atk or atk.color != color:
                continue
            valuable = [
                sq
                for sq in chess.SQUARES
                if b.is_attacked_by(color, sq)
                and b.piece_at(sq)
                and b.piece_at(sq).color == opp
                and PIECE_VALUES.get(b.piece_at(sq).piece_type, 0) >= 305
            ]
            if len(valuable) >= 2:
                result.append(piece_sq)
        return result

    new_forks = [sq for sq in forks(board_after) if sq not in forks(board_before)]

    pins_before = sum(
        1
        for sq in chess.SQUARES
        if board_before.piece_at(sq)
        and board_before.piece_at(sq).color == opp
        and board_before.is_pinned(opp, sq)
    )
    pins_after = sum(
        1
        for sq in chess.SQUARES
        if board_after.piece_at(sq)
        and board_after.piece_at(sq).color == opp
        and board_after.is_pinned(opp, sq)
    )
    new_pins = max(0, pins_after - pins_before)

    is_check = board_after.is_check()
    is_checkmate = board_after.is_checkmate()

    tm_score = (
        len(new_hanging) * 3
        + len(new_forks) * 4
        + new_pins * 2
        + (999 if is_checkmate else 0)
        + (5 if is_check else 0)
        + len(new_attacks) * 1
    )

    return {
        "new_attacks": len(new_attacks),
        "new_hanging": len(new_hanging),
        "new_forks": len(new_forks),
        "new_pins": new_pins,
        "is_check": is_check,
        "is_checkmate": is_checkmate,
        "multiplexing_score": tm_score,
    }


def expectation_violation(board, move, color):
    from_sq, to_sq = move.from_square, move.to_square
    piece = board.piece_at(from_sq)
    if not piece:
        return {"violations": [], "ev_score": 0}

    to_r = chess.square_rank(to_sq)
    from_r = chess.square_rank(from_sq)
    to_f = chess.square_file(to_sq)
    is_backward = (to_r < from_r) if color == chess.WHITE else (to_r > from_r)

    board_after = board.copy()
    board_after.push(move)
    violations = []

    if is_backward and not board.is_capture(move) and piece.piece_type != chess.KING:
        violations.append(("backward_non_capture", 2))

    if piece.piece_type == chess.QUEEN and is_backward and not board.is_capture(move):
        violations.append(("queen_retreat", 3))

    if to_f in (0, 7) and piece.piece_type == chess.KNIGHT:
        violations.append(("knight_to_rim", 2))
    elif to_f in (0, 7) and piece.piece_type in (chess.BISHOP, chess.QUEEN):
        violations.append(("major_piece_to_rim", 1))

    if piece.piece_type == chess.KING and game_phase(board) == "middlegame":
        violations.append(("king_walk_middlegame", 4))

    if board.is_pinned(color, from_sq):
        violations.append(("moving_apparent_pin", 5))

    if not board.is_capture(move) and not board_after.is_check():
        violations.append(("quiet_waiting_move", 2))

    ev_score = sum(w for _, w in violations)
    return {"violations": [v[0] for v in violations], "ev_score": ev_score}


def detect_zugzwang_setup(board_after, attacker_color):
    """Does the resulting position put the opponent in zugzwang (or near-zugzwang)?"""
    opp = not attacker_color
    b = board_after.copy()
    b.turn = opp

    opp_moves = list(b.legal_moves)
    if not opp_moves:
        return {"zugzwang_score": 0.0, "is_likely_zugzwang": False, "moves_sampled": 0}

    def_mat_before = sum(
        PIECE_VALUES.get(pt, 0) * len(board_after.pieces(pt, opp))
        for pt in PIECE_VALUES
        if pt != chess.KING
    )

    moves_that_worsen = 0
    sample_moves = opp_moves[:16]

    for m in sample_moves:
        b2 = b.copy()
        b2.push(m)
        def_mat_after = sum(
            PIECE_VALUES.get(pt, 0) * len(b2.pieces(pt, opp))
            for pt in PIECE_VALUES
            if pt != chess.KING
        )
        b2.turn = opp
        mob_after = len(list(b2.legal_moves))
        loses_mat = def_mat_after < def_mat_before - 30
        loses_mobility = mob_after < max(1, len(opp_moves)) * 0.5
        if loses_mat or loses_mobility:
            moves_that_worsen += 1

    ratio = moves_that_worsen / len(sample_moves)
    return {
        "zugzwang_score": round(ratio, 3),
        "is_likely_zugzwang": ratio > 0.7,
        "moves_sampled": len(sample_moves),
    }


def detect_domination(board_after, attacker_color):
    """One piece traps another of equal or higher value."""
    opp = not attacker_color
    dominated = []

    for target_sq in chess.SQUARES:
        target = board_after.piece_at(target_sq)
        if not target or target.color != opp or target.piece_type == chess.KING:
            continue

        b_test = board_after.copy()
        b_test.turn = opp
        piece_moves = [m for m in b_test.legal_moves if m.from_square == target_sq]
        if not piece_moves:
            continue

        safe_escapes = sum(
            1
            for m in piece_moves
            if not board_after.is_attacked_by(attacker_color, m.to_square)
        )

        if safe_escapes == 0 and len(piece_moves) >= 2:
            piece_value = PIECE_VALUES.get(target.piece_type, 0)
            if piece_value >= PIECE_VALUES[chess.KNIGHT]:
                dominated.append({
                "square": chess.square_name(target_sq),
                "type": target.symbol(),
                "value": PIECE_VALUES.get(target.piece_type, 0),
                "n_moves": len(piece_moves),
            })

    return {
        "dominated_pieces": dominated,
        "domination_count": len(dominated),
        "has_domination": len(dominated) > 0,
        "dominated_value": sum(d["value"] for d in dominated),
    }


def quiet_brilliant_detector(board, move, color):
    """Quiet brilliance detection for non-capture, non-check moves."""
    board_after = board.copy()
    board_after.push(move)

    is_capture = board.is_capture(move)
    is_check = board_after.is_check()
    is_quiet = not is_capture and not is_check

    to_sq = move.to_square
    from_sq = move.from_square
    piece = board.piece_at(from_sq)
    opp = not color

    ctrl_before = sum(1 for sq in chess.SQUARES if board.is_attacked_by(color, sq))
    ctrl_after = sum(1 for sq in chess.SQUARES if board_after.is_attacked_by(color, sq))
    ctrl_gain = ctrl_after - ctrl_before

    b_opp_before = board.copy()
    b_opp_before.turn = opp
    b_opp_after = board_after.copy()
    b_opp_after.turn = opp
    opp_mob_loss = len(list(b_opp_before.legal_moves)) - len(list(b_opp_after.legal_moves))

    xray_alignment = False
    if piece:
        to_r, to_f = chess.square_rank(to_sq), chess.square_file(to_sq)
        opp_king = board.king(opp)
        if opp_king is not None:
            opp_kr, opp_kf = chess.square_rank(opp_king), chess.square_file(opp_king)
            if piece.piece_type in (chess.ROOK, chess.QUEEN):
                xray_alignment = to_r == opp_kr or to_f == opp_kf
            elif piece.piece_type in (chess.BISHOP, chess.QUEEN):
                xray_alignment = abs(to_r - opp_kr) == abs(to_f - opp_kf)

    phase = game_phase(board)
    zugzwang = {"zugzwang_score": 0.0, "is_likely_zugzwang": False}
    if phase == "endgame":
        zugzwang = detect_zugzwang_setup(board_after, color)

    domination = detect_domination(board_after, color)

    opp_threats_before = sum(
        1
        for m in list(b_opp_before.legal_moves)[:20]
        if board.gives_check(m)
    )
    opp_threats_after = sum(
        1
        for m in list(b_opp_after.legal_moves)[:20]
        if board_after.gives_check(m)
    )
    threat_reduction = opp_threats_before - opp_threats_after

    quiet_score = (
        ctrl_gain * 0.3
        + opp_mob_loss * 0.4
        + (5 if xray_alignment else 0)
        + zugzwang["zugzwang_score"] * 8.0
        + domination["domination_count"] * 4.0
        + threat_reduction * 1.0
    )

    archetype = "quiet_move"
    if zugzwang["is_likely_zugzwang"]:
        archetype = "zugzwang_creation"
    elif domination["has_domination"]:
        archetype = "domination"
    elif xray_alignment:
        archetype = "hidden_battery"
    elif threat_reduction > 2:
        archetype = "prophylaxis"
    elif opp_mob_loss > 5:
        archetype = "restriction"

    return {
        "is_quiet": is_quiet,
        "ctrl_gain": ctrl_gain,
        "opp_mob_loss": opp_mob_loss,
        "xray_alignment": xray_alignment,
        "zugzwang": zugzwang,
        "domination": domination,
        "threat_reduction": threat_reduction,
        "quiet_score": round(quiet_score, 2),
        "quiet_archetype": archetype,
        "proceed_to_engine": is_quiet and quiet_score > 3.0,
    }


def defensive_context(board, color):
    """Material deficit before move — triggers defensive brilliance branch."""
    bal = material_balance(board, color)
    material_deficit = max(0, -bal)
    return {
        "material_deficit": material_deficit,
        "is_defending": material_deficit > 150,
    }


def piece_harmony(board_before, board_after, color):
    def controlled(b, c):
        return sum(1 for sq in chess.SQUARES if b.is_attacked_by(c, sq))

    ctrl_delta = controlled(board_after, color) - controlled(board_before, color)

    def mobility(b, c):
        b2 = b.copy()
        b2.turn = c
        pieces = sum(
            1
            for sq in chess.SQUARES
            if b2.piece_at(sq) and b2.piece_at(sq).color == c and b2.piece_at(sq).piece_type != chess.KING
        )
        return len(list(b2.legal_moves)) / max(1, pieces)

    act_delta = mobility(board_after, color) - mobility(board_before, color)

    return {
        "control_delta": ctrl_delta,
        "activity_delta": round(act_delta, 2),
        "harmony_score": round(ctrl_delta * 0.3 + act_delta * 2.0, 2),
    }


def analyze_move(board, move, ply_index):
    color = board.turn
    board_after = board.copy()
    board_after.push(move)

    phase = game_phase(board)
    sac = is_sacrifice_candidate(board, move, color)
    vuln = analyze_piece_vulnerability(board, move.from_square, color)

    king_s_before_opp = king_safety(board, not color)
    king_s_after_opp = king_safety(board_after, not color)
    king_s_delta_opp = king_s_after_opp["total_safety"] - king_s_before_opp["total_safety"]

    tm = tactical_multiplexing(board, board_after, color)
    ev = expectation_violation(board, move, color)
    harmony = piece_harmony(board, board_after, color)
    quiet = quiet_brilliant_detector(board, move, color)
    def_ctx = defensive_context(board, color)

    mat_before = material_balance(board, color)
    mat_after = material_balance(board_after, color)

    from brilliance_gates import compute_engine_candidacy

    candidacy = compute_engine_candidacy(board, move, ply_index)

    return {
        "ply_index": ply_index,
        "san_move": board.san(move),
        "uci_move": move.uci(),
        "fen_before": board.fen(),
        "turn": "white" if color == chess.WHITE else "black",
        "setup": {
            "game_phase": phase,
            "game_phase_code": game_phase_code(phase),
            "material_balance_before": mat_before,
            "material_balance_after": mat_after,
            "material_delta": mat_after - mat_before,
        },
        "see": sac,
        "piece_vulnerability": vuln,
        "piece_hanging": vuln,
        "king_safety": {
            "opp_before": king_s_before_opp,
            "opp_after": king_s_after_opp,
            "opp_king_safety_delta": king_s_delta_opp,
        },
        "tactical_multiplexing": tm,
        "expectation_violation": ev,
        "piece_harmony": harmony,
        "quiet_brilliance": quiet,
        "defensive_context": def_ctx,
        "is_sacrifice_candidate": sac["is_sacrifice_candidate"],
        "proceed_to_stage1": sac["is_sacrifice_candidate"],
        "proceed_to_engine": candidacy["proceed_to_engine"],
        "engine_candidate_path": candidacy.get("engine_candidate_path"),
    }


def analyze_pgn(pgn_text):
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise ValueError("Could not parse PGN")

    board = game.board()
    moves_out = []

    for ply_index, move in enumerate(game.mainline_moves()):
        moves_out.append(analyze_move(board, move, ply_index))
        board.push(move)

    sacrifice_count = sum(1 for m in moves_out if m["is_sacrifice_candidate"])
    engine_candidate_count = sum(1 for m in moves_out if m["proceed_to_engine"])

    return {
        "move_count": len(moves_out),
        "sacrifice_candidate_count": sacrifice_count,
        "engine_candidate_count": engine_candidate_count,
        "moves": moves_out,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "input_json is required"}))
        return 1

    try:
        payload = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        return 1

    pgn = payload.get("pgn") or payload.get("clean_pgn")
    if not pgn:
        print(json.dumps({"error": "pgn is required"}))
        return 1

    try:
        result = analyze_pgn(pgn)
        print(json.dumps(result))
        return 0
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
