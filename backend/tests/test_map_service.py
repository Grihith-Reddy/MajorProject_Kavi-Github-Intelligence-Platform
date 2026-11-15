import unittest

from app.services.map_service import bus_factor, module_of


class MapServiceTests(unittest.TestCase):
    def test_module_of_groups_two_levels_deep(self):
        self.assertEqual(module_of("backend/app/api/chat.py"), "backend/app")
        self.assertEqual(module_of("src/main.ts"), "src")
        self.assertEqual(module_of("README.md"), "(root)")

    def test_bus_factor_counts_people_covering_majority(self):
        self.assertEqual(bus_factor({"alice": 9, "bob": 1}), 1)
        self.assertEqual(bus_factor({"alice": 4, "bob": 4, "carol": 2}), 2)
        self.assertEqual(bus_factor({"a": 1, "b": 1, "c": 1, "d": 1}), 3)
        self.assertEqual(bus_factor({}), 0)


if __name__ == "__main__":
    unittest.main()
