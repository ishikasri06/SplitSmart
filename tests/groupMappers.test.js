import test from "node:test";
import assert from "node:assert/strict";
import { mapDatabaseGroup } from "../src/groupMappers.js";

test("maps a database group to the isolated cloud UI shape", () => {
  const group = mapDatabaseGroup({
    id: "44a7f356-967d-4f22-9b79-03af700d9fb3",
    name: "Goa Getaway",
    group_type: "Trip",
    description: null,
    created_by: "0eab049a-1e21-48f2-8d9c-9360f3fce6c4",
    created_at: "2026-10-14T12:00:00.000Z",
    phone_number: "+91 90000 00000",
  });

  assert.deepEqual(group, {
    id: "44a7f356-967d-4f22-9b79-03af700d9fb3",
    name: "Goa Getaway",
    type: "Trip",
    description: "",
    createdBy: "0eab049a-1e21-48f2-8d9c-9360f3fce6c4",
    createdAt: "2026-10-14T12:00:00.000Z",
  });
  assert.equal("memberIds" in group, false);
  assert.equal("phone_number" in group, false);
});

test("preserves a cloud group description", () => {
  const group = mapDatabaseGroup({
    id: "bc2c2169-59d9-4fd5-a2c7-71b3179159cb",
    name: "Flat 302",
    group_type: "Home",
    description: "Rent and utilities",
    created_by: "3fed2c95-63d9-4f2e-a6a2-e84d6d5f0107",
    created_at: "2026-10-14T13:00:00.000Z",
  });

  assert.equal(group.description, "Rent and utilities");
  assert.equal(group.type, "Home");
});
