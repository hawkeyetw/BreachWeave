// Engagement bootstrap: compile a TestPolicy + scope + seeds into a ready
// pentest-workspace and hand back the env that activates the Slice 1 kernel.
//
// I/O orchestration only (Bun.file / Bun.write); all mapping logic lives in
// policy.ts. Reuses the pentest-workspace primitives (ensurePentestWorkspace /
// writeRunState) so the produced workspace round-trips through readRunPolicy /
// readRunState / readEngagementCompletion.

import { ENGAGEMENT_ENV_DIR, ENGAGEMENT_ENV_ID } from "./env"
import { compileTestPolicy, type TestPolicy } from "./policy"
import { ensurePentestWorkspace, pentestWorkspacePath, writeRunState, type RunState } from "../config/tools/pentest-workspace"
import { join } from "path"

/** Persisted alongside run-policy.json so solver/observer can read the original strategy intent. */
export const ENGAGEMENT_POLICY_FILE = "engagement-policy.json"

export interface EngagementPolicyRecord {
    engagementId: string
    authorizedTargets: string[]
    seeds: string[]
    policy: TestPolicy
}

export interface BootstrapEngagementInput {
    engagementId: string
    workspaceDir: string
    authorizedTargets: string[]
    seeds: string[]
    policy: TestPolicy
}

export interface BootstrapEngagementResult {
    env: Record<string, string>
}

function createInitialRunState(): RunState {
    const now = new Date().toISOString()
    return {
        current_phase: "SCOPE",
        completed_phases: [],
        cycle: 0,
        reentry_count: 0,
        active_hypothesis_id: null,
        goal_achieved: false,
        goal_output_id: null,
        goal_evidence_refs: [],
        goal_achieved_at: null,
        last_updated: now,
        transitions: [{ phase: "SCOPE", at: now, reason: "engagement_bootstrap" }],
    }
}

/**
 * Compile + persist an engagement workspace and return its activation env.
 *
 * Steps (spec §3):
 * 1. ensurePentestWorkspace — create dirs + default files (idempotent; keeps existing findings).
 * 2. Overwrite run-policy.json with compileTestPolicy(policy, authorizedTargets).
 * 3. Write engagement-policy.json (full TestPolicy + authorizedTargets + seeds).
 * 4. Initialize state/run-state.json at phase=SCOPE.
 * 5. Return env = { ENGAGEMENT_ID, ENGAGEMENT_DIR }.
 *
 * Idempotent: re-running does not clobber existing findings; run-policy /
 * engagement-policy are refreshed to the latest compiled policy.
 */
export async function bootstrapEngagement(input: BootstrapEngagementInput): Promise<BootstrapEngagementResult> {
    const { engagementId, workspaceDir, authorizedTargets, seeds, policy } = input

    await ensurePentestWorkspace(workspaceDir)

    const runPolicy = compileTestPolicy(policy, authorizedTargets)
    await Bun.write(pentestWorkspacePath(workspaceDir, "runPolicy"), JSON.stringify(runPolicy, null, 2))

    const engagementPolicy: EngagementPolicyRecord = {
        engagementId,
        authorizedTargets: runPolicy.allowed_targets,
        seeds: seeds.map((seed) => seed.trim()).filter((seed) => seed.length > 0),
        policy,
    }
    await Bun.write(join(workspaceDir, ENGAGEMENT_POLICY_FILE), JSON.stringify(engagementPolicy, null, 2))

    await writeRunState(workspaceDir, createInitialRunState())

    return {
        env: {
            [ENGAGEMENT_ENV_ID]: engagementId,
            [ENGAGEMENT_ENV_DIR]: workspaceDir,
        },
    }
}
