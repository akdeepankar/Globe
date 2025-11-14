const templates = {
  Facts: (place) =>
    'Quick facts about ' + place + ':\n- Population: fascinating and varied\n- Famous for: local culture and landmarks\n- Geography: a beautiful mix of terrain\nExplore deeper to learn more.',
  Story: (place) =>
    'A tiny story from ' + place + ':\nAt dusk, the market lights braided with the sea breeze. A traveler found an old map that smelled of cinnamon and rain, and followed it to a little door where the moon told secrets.',
  Travel: (place) =>
    'Travel tips for ' + place + ':\n- Best time to visit: spring and autumn\n- Must-try: local cuisine and markets\n- Quick itinerary: 2 days of sights, 1 day to wander\nPack light and bring curiosity.',
  Lore: (place) =>
    'Lore of ' + place + ':\nLocal tales say this place was once cradled by sky-spirits who hid stars in the river. People leave small ribbons to honor their promises.'
}

export default {
  generate(mode = 'Facts', place = 'this place') {
    const fn = templates[mode] || templates.Facts
    return fn(place)
  }
}
