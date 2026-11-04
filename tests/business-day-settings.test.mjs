import assert from "node:assert/strict";
import { it } from "node:test";
import { ownerRestaurantPatchSchema, restaurantPatchSchema } from "../dist/validators.js";

it("accepts business-day settings without overwriting them in unrelated patches", () => {
  for (const schema of [ownerRestaurantPatchSchema, restaurantPatchSchema]) {
    for (const businessDayStartTime of ["00:00", "04:00", "05:30", "23:59"]) {
      assert.equal(schema.parse({ businessDayStartTime }).businessDayStartTime, businessDayStartTime);
    }
    assert.equal(Object.hasOwn(schema.parse({ phone: "123" }), "businessDayStartTime"), false);
    for (const businessDayStartTime of ["24:00", "4:00", "04:60", "", "04:00:00", null, 4]) {
      assert.equal(schema.safeParse({ businessDayStartTime }).success, false);
    }
  }
});
