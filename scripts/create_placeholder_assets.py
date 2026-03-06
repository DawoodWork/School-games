#!/usr/bin/env python3
"""
Create placeholder sprite assets for Ashen Lineage
"""
from PIL import Image, ImageDraw

def create_equipment_icons():
    """Create a spritesheet with equipment icons (16x16 each)"""
    # 3x3 grid of 16x16 icons = 48x48 total
    img = Image.new('RGBA', (48, 48), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Equipment items and their colors
    items = [
        # Row 1: Swords
        ('iron_sword', (170, 170, 200)),     # light blue-gray
        ('steel_sword', (200, 200, 220)),    # lighter gray
        ('dark_blade', (130, 70, 170)),      # purple
        # Row 2: Shields
        ('iron_shield', (150, 150, 150)),    # gray
        ('steel_shield', (135, 135, 170)),   # blue-gray
        (None, (0, 0, 0, 0)),                # empty
        # Row 3: Armor
        ('leather_armor', (170, 135, 100)),  # brown
        ('chain_armor', (170, 170, 170)),    # gray
        ('plate_armor', (200, 185, 170)),    # light brown
    ]
    
    for i, (item, color) in enumerate(items):
        if item is None:
            continue
            
        x = (i % 3) * 16
        y = (i // 3) * 16
        
        if 'sword' in item:
            # Draw sword shape
            draw.rectangle([x+6, y+2, x+9, y+13], fill=color)  # blade
            draw.rectangle([x+5, y+10, x+10, y+12], fill=(139, 69, 19))  # hilt
            draw.rectangle([x+7, y+13, x+8, y+14], fill=(101, 67, 33))  # handle
        elif 'shield' in item:
            # Draw shield shape
            draw.ellipse([x+3, y+2, x+12, y+13], fill=color)
            draw.rectangle([x+6, y+4, x+9, y+11], fill=(255, 255, 255))  # cross
            draw.rectangle([x+4, y+7, x+11, y+8], fill=(255, 255, 255))
        elif 'armor' in item:
            # Draw armor piece
            draw.rectangle([x+4, y+3, x+11, y+12], fill=color)
            draw.rectangle([x+5, y+4, x+10, y+6], fill=tuple(min(255, c+30) for c in color[:3]))  # highlight
    
    img.save('/Users/woody/ashen-lineage/assets/sprites/equipment_icons.png')
    print("Created equipment_icons.png")

def create_spell_effects():
    """Create spell effect sprites (16x16 each)"""
    # 3x3 grid of 16x16 effects = 48x48 total
    img = Image.new('RGBA', (48, 48), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    spells = [
        ('ignis', (255, 68, 0)),        # fire orange
        ('gelidus', (68, 204, 255)),    # ice blue  
        ('tenebris', (102, 34, 170)),   # dark purple
        ('viribus', (255, 204, 0)),     # buff yellow
        ('contrarium', (204, 0, 204)),  # mana lock purple
        ('trickstus', (0, 255, 170)),   # teleport green
        ('armis', (68, 136, 255)),      # shield blue
        ('fimbulvetr', (136, 221, 255)), # frost light blue
        ('manus_dei', (255, 238, 68)),  # divine light yellow
    ]
    
    for i, (spell, color) in enumerate(spells):
        x = (i % 3) * 16
        y = (i // 3) * 16
        
        # Create a glowing orb effect
        for radius in [6, 4, 2]:
            alpha = 255 - radius * 30
            glow_color = color + (alpha,)
            draw.ellipse([x+8-radius, y+8-radius, x+8+radius, y+8+radius], fill=glow_color)
    
    img.save('/Users/woody/ashen-lineage/assets/sprites/spell_effects.png')
    print("Created spell_effects.png")

def create_item_icons():
    """Create consumable item icons"""
    img = Image.new('RGBA', (32, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Health potion (left half)
    draw.rectangle([2, 4, 6, 12], fill=(68, 204, 68))  # green bottle
    draw.rectangle([3, 2, 5, 4], fill=(139, 69, 19))   # cork
    draw.rectangle([3, 6, 5, 10], fill=(102, 255, 102)) # liquid
    
    # Mana potion (right half) 
    draw.rectangle([18, 4, 22, 12], fill=(68, 136, 255)) # blue bottle
    draw.rectangle([19, 2, 21, 4], fill=(139, 69, 19))   # cork
    draw.rectangle([19, 6, 21, 10], fill=(136, 170, 255)) # liquid
    
    img.save('/Users/woody/ashen-lineage/assets/sprites/item_icons.png')
    print("Created item_icons.png")

if __name__ == '__main__':
    create_equipment_icons()
    create_spell_effects()
    create_item_icons()
    print("All placeholder assets created!")