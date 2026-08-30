import { Module } from '@nestjs/common';

// Section 23: versioned declarative JSON configuration, no DSL, no rules-engine
// product. Epic 9 — ship with two seeded rulesets (Westpac-modelled + deliberately
// different) before this is considered done; "the second one needs a code change" is
// a failed design, per the master document's own test.
@Module({})
export class RulesetsModule {}
