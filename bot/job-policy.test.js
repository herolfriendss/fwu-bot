import test from "node:test";
import assert from "node:assert/strict";
import { JOBS, JOB_MAX_LEVEL, JOB_XP_PER_LEVEL, jobPayout, jobProgress } from "./job-policy.js";

test("job list is a finite set of distinct professions", () => {
  assert.equal(Object.keys(JOBS).length, 5);
  assert.equal(new Set(Object.keys(JOBS)).size, 5);
});

test("work payouts grow by five percent per level and stay capped", () => {
  assert.equal(jobPayout(101, 1), 101);
  assert.equal(jobPayout(100, 2), 105);
  assert.equal(jobPayout(100, JOB_MAX_LEVEL), 145);
  assert.equal(jobPayout(100, JOB_MAX_LEVEL + 100), 145);
  assert.throws(() => jobPayout(-1, 1), /invalide/);
});

test("job experience levels up deterministically and caps at level ten", () => {
  assert.deepEqual(jobProgress({ level: 1, experience: 75 }), {
    level: 2,
    experience: 0,
    levelsGained: 1,
  });
  assert.deepEqual(jobProgress({ level: 3, experience: 90, earned: 225 }), {
    level: 6,
    experience: 15,
    levelsGained: 3,
  });
  assert.deepEqual(jobProgress({ level: 9, experience: 90 }), {
    level: 10,
    experience: 0,
    levelsGained: 1,
  });
  assert.deepEqual(jobProgress({ level: 10, experience: 90 }), {
    level: 10,
    experience: 0,
    levelsGained: 0,
  });
  assert.equal(JOB_XP_PER_LEVEL, 100);
});
