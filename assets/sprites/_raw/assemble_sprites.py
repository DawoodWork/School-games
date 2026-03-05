#!/usr/bin/env python3
"""Assemble PixelLab character outputs into game sprite sheets.

Expected game format:
  - 4 rows: south(0), west(1), east(2), north(3)
  - 4 columns: animation frames
  - Each cell: SPRITE_W x SPRITE_H pixels
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '.pip_packages'))

from PIL import Image

RAW_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(RAW_DIR, '..')
CELL_W = 32
CELL_H = 32
DIRECTIONS = ['south', 'west', 'east', 'north']

def assemble_player():
    """Player has walking animation frames for south/east/north; mirror east->west."""
    sheet = Image.new('RGBA', (CELL_W * 4, CELL_H * 4), (0, 0, 0, 0))

    for row, direction in enumerate(DIRECTIONS):
        anim_dir = os.path.join(RAW_DIR, 'player_default', 'animations', 'walking-4-frames', direction)

        if os.path.isdir(anim_dir):
            for col in range(4):
                frame_path = os.path.join(anim_dir, f'frame_{col:03d}.png')
                if os.path.exists(frame_path):
                    frame = Image.open(frame_path)
                    sheet.paste(frame, (col * CELL_W, row * CELL_H))
        elif direction == 'west':
            east_dir = os.path.join(RAW_DIR, 'player_default', 'animations', 'walking-4-frames', 'east')
            if os.path.isdir(east_dir):
                for col in range(4):
                    frame_path = os.path.join(east_dir, f'frame_{col:03d}.png')
                    if os.path.exists(frame_path):
                        frame = Image.open(frame_path).transpose(Image.FLIP_LEFT_RIGHT)
                        sheet.paste(frame, (col * CELL_W, row * CELL_H))
        else:
            rot_path = os.path.join(RAW_DIR, 'player_default', 'rotations', f'{direction}.png')
            if os.path.exists(rot_path):
                rot = Image.open(rot_path)
                for col in range(4):
                    sheet.paste(rot, (col * CELL_W, row * CELL_H))

    out_path = os.path.join(OUT_DIR, 'player_default.png')
    sheet.save(out_path)
    print(f'Saved {out_path} ({sheet.size[0]}x{sheet.size[1]})')

def find_rotation(name, direction):
    """Find rotation PNG in either flat or nested layout."""
    paths = [
        os.path.join(RAW_DIR, name, f'{direction}.png'),
        os.path.join(RAW_DIR, name, 'rotations', f'{direction}.png'),
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    return None

def assemble_static(name, out_name=None):
    """Static character -- use rotation images, duplicate across 4 frame columns."""
    sheet = Image.new('RGBA', (CELL_W * 4, CELL_H * 4), (0, 0, 0, 0))

    for row, direction in enumerate(DIRECTIONS):
        rot_path = find_rotation(name, direction)
        if not rot_path:
            if direction == 'west':
                east_path = find_rotation(name, 'east')
                if east_path:
                    rot = Image.open(east_path).transpose(Image.FLIP_LEFT_RIGHT)
                else:
                    continue
            else:
                continue
        else:
            rot = Image.open(rot_path)

        for col in range(4):
            sheet.paste(rot, (col * CELL_W, row * CELL_H))

    fname = out_name or name
    out_path = os.path.join(OUT_DIR, f'{fname}.png')
    sheet.save(out_path)
    print(f'Saved {out_path} ({sheet.size[0]}x{sheet.size[1]})')

if __name__ == '__main__':
    assemble_player()

    for npc in ['npc_doctor', 'npc_blacksmith', 'npc_trainer', 'npc_guard']:
        npc_dir = os.path.join(RAW_DIR, npc)
        if os.path.isdir(npc_dir):
            assemble_static(npc)

    for race in ['gaian', 'morvid', 'vampire', 'azael', 'human', 'dwarf']:
        race_dir = os.path.join(RAW_DIR, race)
        if os.path.isdir(race_dir):
            assemble_static(race, f'race_{race}')

    print('Assembly complete.')
