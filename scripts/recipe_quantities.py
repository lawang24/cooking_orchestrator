"""Compatible unit families for measurement validation and meal totals."""

from recipe_types import Unit


# Units of one kind convert to a common base so portions can be totaled.
UNIT_SCALES: tuple[dict[Unit, float], ...] = (
    {'tsp': 1, 'tbsp': 3, 'cup': 48, 'ml': 1 / 4.92892159375, 'l': 1000 / 4.92892159375},
    {'g': 1, 'kg': 1000, 'oz': 28.349523125, 'lb': 453.59237},
    {'whole': 1},
)
