begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(36);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202608300003'
  ),
  1::bigint,
  'the expanded method and agency boundary migration committed'
);

select extensions.is(
  (
    select pg_catalog.count(*)
    from supabase_migrations.schema_migrations as migration
    where migration.version = '202608310003'
  ),
  1::bigint,
  'the additive method eligibility v3 boundary migration committed'
);

select extensions.is(
  public.study_route_method_name_v2('self_explanation'),
  'Feynman Technique',
  'self-explanation projects the recognizable Feynman name'
);

select extensions.is(
  public.study_route_method_name_v2('read_recall_review'),
  'SQ3R',
  'read-recall-review projects the recognizable SQ3R name'
);

select extensions.is(
  public.study_route_method_name_v2('pretesting'),
  'Pretesting',
  'Pretesting has a stable catalog identity'
);

select extensions.is(
  public.study_route_method_name_v2('concept_mapping'),
  'Concept Mapping',
  'Concept Mapping has a stable catalog identity'
);

select extensions.is(
  public.study_route_method_name_v2('practice_problems'),
  'Practice Problems',
  'Practice Problems has a stable catalog identity'
);

select extensions.is(
  public.study_route_method_phases_v2('self_explanation', 'learn'),
  array['model', 'explain', 'repair', 'reexplain']::text[],
  'the Feynman contract includes repair and a second explanation'
);

select extensions.is(
  public.study_route_method_phases_v2('read_recall_review', 'study'),
  array['survey', 'question', 'read_source', 'retrieve', 'review']::text[],
  'the SQ3R contract preserves all five named phases'
);

select extensions.is(
  public.study_route_method_phases_v2('concept_mapping', 'learn'),
  array['model', 'retrieve', 'connect', 'evidence_match', 'repair']::text[],
  'Learn-mode Concept Mapping prepends an accurate model'
);

select extensions.is(
  public.study_route_method_phases_v2('practice_problems', 'study'),
  array['independent_practice', 'transfer']::text[],
  'Practice Problems creates repair only after an observed runtime miss'
);

select extensions.lives_ok(
  $statement$
    select public.assert_study_route_method_catalog_v2($route$
      {
        "approach": {
          "primaryMethodId": "concept_mapping",
          "visibleMethodName": "Concept Mapping"
        },
        "execution": {
          "orderedPhases": [
            {"methodPhase": "model"},
            {"methodPhase": "connect"}
          ]
        },
        "agency": {
          "alternatives": [
            {
              "primaryMethodId": "pretesting",
              "visibleMethodName": "Pretesting"
            },
            {
              "primaryMethodId": "self_explanation",
              "visibleMethodName": "Feynman Technique"
            }
          ]
        }
      }
    $route$::jsonb)
  $statement$,
  'the catalog guard accepts expanded IDs, phases, and presentation names'
);

select extensions.throws_ok(
  $statement$
    select public.assert_study_route_method_catalog_v2($route$
      {
        "approach": {
          "primaryMethodId": null,
          "visibleMethodName": "Concept Mapping"
        },
        "execution": {"orderedPhases": [{"methodPhase": "connect"}]},
        "agency": {"alternatives": []}
      }
    $route$::jsonb)
  $statement$,
  '22023',
  'study_route_semantic_method_catalog_invalid',
  'a JSON-null method ID fails closed rather than bypassing NOT IN'
);

select extensions.throws_ok(
  $statement$
    select public.assert_study_route_method_catalog_v2($route$
      {
        "approach": {
          "primaryMethodId": "read_recall_review",
          "visibleMethodName": "SQ3R"
        },
        "execution": {"orderedPhases": [{"methodPhase": null}]},
        "agency": {"alternatives": []}
      }
    $route$::jsonb)
  $statement$,
  '22023',
  'study_route_semantic_phase_invalid',
  'a JSON-null method phase fails closed'
);

select extensions.throws_ok(
  $statement$
    select public.assert_study_route_method_catalog_v2($route$
      {
        "approach": {
          "primaryMethodId": "self_explanation",
          "visibleMethodName": "Feynman Technique"
        },
        "execution": {"orderedPhases": [{"methodPhase": "reexplain"}]},
        "agency": {
          "alternatives": [{
            "primaryMethodId": "pretesting",
            "visibleMethodName": "Passive rereading"
          }]
        }
      }
    $route$::jsonb)
  $statement$,
  '22023',
  'study_route_semantic_alternative_invalid',
  'an ID/name mismatch in an alternative fails closed'
);

select extensions.ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
      like '%perform public.assert_study_route_method_catalog_v2(route_payload)%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%perform public.assert_study_route_payload_legacy_v1(adapted_payload)%'
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.assert_study_route_payload_v1(jsonb)'
    )
  ),
  'the stable validator composes the catalog guard with the private legacy structural pass'
);

select extensions.ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
      like '%predecessor_route_payload #> ''{provenance,ruletrace}''%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%change_plan_session_method_with_route_v3(payload)%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%change_plan_session_method_with_route_v2(payload)%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%change_plan_session_method_with_route_legacy_v1(payload)%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        not like '%successorstudyroute%'
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.change_plan_session_method_with_route(jsonb)'
    )
  ),
  'the public RPC selects its private writer only from the owned stored predecessor trace'
);

select extensions.ok(
  (
    select pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
      not like '%40001%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%post_commit_method_choice_not_offered%'
      and pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid))
        like '%expected_alternative_ids%'
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.change_plan_session_method_with_route_v2(jsonb)'
    )
  ),
  'the versioned choice path is bounded and contains no retryable serialization SQLSTATE'
);

select extensions.ok(
  not exists (
    select 1
    from (values
      ('public.assert_study_route_payload_legacy_v1(jsonb)'),
      ('public.assert_study_route_payload_v1(jsonb)'),
      ('public.assert_study_route_method_catalog_v2(jsonb)'),
      ('public.study_route_method_names_v2(text)'),
      ('public.study_route_method_phases_v2(text,text)'),
      ('public.change_plan_session_method_with_route_legacy_v1(jsonb)'),
      ('public.change_plan_session_method_with_route_v2(jsonb)'),
      ('public.change_plan_session_method_with_route_v3(jsonb)')
    ) as private_routine(signature)
    cross join (values
      ('anon'),
      ('authenticated'),
      ('service_role')
    ) as actor(role_name)
    where pg_catalog.has_function_privilege(
      actor.role_name,
      private_routine.signature,
      'execute'
    )
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.change_plan_session_method_with_route(jsonb)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.change_plan_session_method_with_route(jsonb)',
    'execute'
  ),
  'only authenticated may execute the stable adapter; every implementation/helper stays private'
);

-- Execute the same payload shape sent by PATCH /api/sessions/method-choice.
-- Pretesting is deliberately absent from agency.alternatives but present in
-- the predecessor's immutable method_eligibility_v2 cohort. This catches a
-- drift where TypeScript authorizes I'll Customize Other methods while the
-- database still limits every request to the two visible alternatives.
create temporary table agency_other_method_fixture (
  user_id uuid not null,
  plan_id uuid not null,
  learning_item_id uuid not null,
  session_id uuid not null,
  predecessor jsonb not null,
  successor jsonb not null
) on commit drop;

insert into agency_other_method_fixture values (
  '11111111-1111-4111-8111-111111111111',
  '04d6a366-7743-477c-9e2b-7cde66f2e2ed',
  '53fc3137-d0de-4d64-b674-d5f5a80d267d',
  'b28be17e-d9bb-4642-af60-e1be56f5928e',
  $route$
  {
    "identity": {
      "routeLineageId": "a2f090cf-b3fe-4c2a-ad46-632ced029095",
      "routeRevisionId": "5fc5b507-f9e8-45c3-8b45-cbeafdeeda39",
      "revisionNumber": 1,
      "schemaVersion": 1,
      "lifecycleStatus": "committed",
      "planId": "04d6a366-7743-477c-9e2b-7cde66f2e2ed",
      "sessionId": "b28be17e-d9bb-4642-af60-e1be56f5928e",
      "createdAt": "2026-08-24T12:00:00.000Z",
      "committedAt": "2026-08-24T12:01:00.000Z"
    },
    "target": {
      "taskFamily": "problem_solving",
      "desiredOutcome": "Build an accurate first mental model of The product rule for derivatives through a concise explanation and one concrete example.",
      "targetStates": [{
        "targetId": "b74d81a4-18ae-4f12-9ec8-7f133e3e5309",
        "stage": "novice",
        "uncertainty": "unknown",
        "evidenceRefs": []
      }],
      "sourceRequirements": {
        "sourceType": "yova_generated",
        "requiredSourceIds": [],
        "groundingRequired": false,
        "instructions": []
      }
    },
    "approach": {
      "mode": "learn",
      "executionEnvironment": "inside_yova",
      "primaryMethodId": "worked_example_fading",
      "visibleMethodName": "Worked Examples",
      "confidenceLevel": "unknown"
    },
    "timing": {
      "activeMinutes": 25,
      "elapsedMinutes": 25,
      "durationSource": "legacy_reconstruction"
    },
    "execution": {
      "orderedPhases": [
        {
          "phaseId": "method-1-model",
          "methodPhase": "model",
          "activeMinutes": 9,
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"]
        },
        {
          "phaseId": "method-2-guided_practice",
          "methodPhase": "guided_practice",
          "activeMinutes": 8,
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"]
        },
        {
          "phaseId": "method-3-independent_practice",
          "methodPhase": "independent_practice",
          "activeMinutes": 8,
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"]
        }
      ],
      "difficultyTier": "unknown",
      "initialSupport": "supported_start",
      "activityLimit": 4,
      "completionEvidence": [
        {
          "evidenceId": "legacy-evidence-1",
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"],
          "kind": "application",
          "description": "Explain the central relationship in plain language after the model is hidden",
          "requiresIndependentAttempt": true
        },
        {
          "evidenceId": "legacy-evidence-2",
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"],
          "kind": "application",
          "description": "Produce evidence for each listed content target",
          "requiresIndependentAttempt": true
        }
      ],
      "deferredTargets": []
    },
    "agency": {
      "controlMode": "learner_customizes",
      "selectedBy": "yova",
      "alternatives": []
    },
    "explanation": {
      "shortReason": "The fixture baseline is eligible for this exact session.",
      "taskRequirements": [
        "Worked Examples is eligible for this problem solving Learn route at the novice stage."
      ],
      "learnerDeclarations": [],
      "observations": [],
      "uncertainties": []
    },
    "provenance": {
      "routerVersion": "fixture_router_v1+study_route_agency_mode_controller_v1",
      "profileVersion": "fixture_profile_v1",
      "evidenceRefs": [],
      "ruleTrace": [{
        "ruleId": "method_eligibility_v2",
        "result": "worked_example_fading,pretesting,self_explanation",
        "reason": "Task, knowledge stage, and Learn mode limited selection to Worked Examples, Pretesting, Feynman Technique.",
        "evidenceRefs": []
      }]
    }
  }
  $route$::jsonb,
  $route$
  {
    "identity": {
      "routeLineageId": "a2f090cf-b3fe-4c2a-ad46-632ced029095",
      "routeRevisionId": "91000000-0000-4000-8000-000000000002",
      "revisionNumber": 2,
      "schemaVersion": 1,
      "lifecycleStatus": "committed",
      "planId": "04d6a366-7743-477c-9e2b-7cde66f2e2ed",
      "sessionId": "b28be17e-d9bb-4642-af60-e1be56f5928e",
      "createdAt": "2026-08-24T12:05:00.000Z",
      "committedAt": "2026-08-24T12:05:00.000Z",
      "supersedesRevisionId": "5fc5b507-f9e8-45c3-8b45-cbeafdeeda39"
    },
    "target": {
      "taskFamily": "problem_solving",
      "desiredOutcome": "Build an accurate first mental model of The product rule for derivatives through a concise explanation and one concrete example.",
      "targetStates": [{
        "targetId": "b74d81a4-18ae-4f12-9ec8-7f133e3e5309",
        "stage": "novice",
        "uncertainty": "unknown",
        "evidenceRefs": []
      }],
      "sourceRequirements": {
        "sourceType": "yova_generated",
        "requiredSourceIds": [],
        "groundingRequired": false,
        "instructions": []
      }
    },
    "approach": {
      "mode": "learn",
      "executionEnvironment": "inside_yova",
      "primaryMethodId": "pretesting",
      "visibleMethodName": "Pretesting",
      "confidenceLevel": "unknown"
    },
    "timing": {
      "activeMinutes": 25,
      "elapsedMinutes": 25,
      "durationSource": "legacy_reconstruction"
    },
    "execution": {
      "orderedPhases": [
        {
          "phaseId": "method-1-pretest",
          "methodPhase": "pretest",
          "activeMinutes": 9,
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"]
        },
        {
          "phaseId": "method-2-model",
          "methodPhase": "model",
          "activeMinutes": 8,
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"]
        },
        {
          "phaseId": "method-3-transfer",
          "methodPhase": "transfer",
          "activeMinutes": 8,
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"]
        }
      ],
      "difficultyTier": "unknown",
      "initialSupport": "supported_start",
      "activityLimit": 4,
      "completionEvidence": [
        {
          "evidenceId": "legacy-evidence-1",
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"],
          "kind": "application",
          "description": "Explain the central relationship in plain language after the model is hidden",
          "requiresIndependentAttempt": true
        },
        {
          "evidenceId": "legacy-evidence-2",
          "targetIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"],
          "kind": "application",
          "description": "Produce evidence for each listed content target",
          "requiresIndependentAttempt": true
        }
      ],
      "deferredTargets": []
    },
    "agency": {
      "controlMode": "learner_customizes",
      "selectedBy": "learner",
      "alternatives": [{
        "alternativeId": "method-alternative:worked_example_fading",
        "mode": "learn",
        "executionEnvironment": "inside_yova",
        "primaryMethodId": "worked_example_fading",
        "visibleMethodName": "Worked Examples",
        "activeMinutes": 25,
        "tradeoff": "Worked Examples also fits this problem solving Learn session. Study one complete solution, then solve a similar task as support is gradually removed."
      }],
      "override": {
        "requestedAt": "2026-08-24T12:05:00.000Z",
        "changedFields": ["primary_method"],
        "reason": "You chose Pretesting from the methods that fit this session."
      }
    },
    "explanation": {
      "shortReason": "You chose Pretesting from the methods that fit this session.",
      "taskRequirements": [
        "Pretesting is eligible for this problem solving Learn route at the novice stage."
      ],
      "learnerDeclarations": [
        "You chose Pretesting from the methods that fit this session."
      ],
      "observations": [],
      "uncertainties": []
    },
    "provenance": {
      "routerVersion": "fixture_router_v1+study_route_agency_mode_controller_v1+study_route_method_plan_integration_v1+method_decision_evidence_adapter_v2+method_evidence_v1+method_compare_v1+method_runtime_capability_v1+method_presentation_v2",
      "profileVersion": "fixture_profile_v1",
      "evidenceRefs": [
        "route-revision:5fc5b507-f9e8-45c3-8b45-cbeafdeeda39",
        "learner-choice:committed-route:04d6a366-7743-477c-9e2b-7cde66f2e2ed:b28be17e-d9bb-4642-af60-e1be56f5928e:5fc5b507-f9e8-45c3-8b45-cbeafdeeda39:pretesting"
      ],
      "ruleTrace": [
        {
          "ruleId": "method_eligibility_v2",
          "result": "worked_example_fading,pretesting,self_explanation",
          "reason": "Task, knowledge stage, and Learn mode limited selection to Worked Examples, Pretesting, Feynman Technique.",
          "evidenceRefs": []
        },
        {
          "ruleId": "post_commit_method_choice_v1",
          "result": "worked_example_fading->pretesting",
          "reason": "The learner requested an eligible, deliverable method through I'll Customize Other methods for this exact ready session.",
          "evidenceRefs": [
            "route-revision:5fc5b507-f9e8-45c3-8b45-cbeafdeeda39",
            "learner-choice:committed-route:04d6a366-7743-477c-9e2b-7cde66f2e2ed:b28be17e-d9bb-4642-af60-e1be56f5928e:5fc5b507-f9e8-45c3-8b45-cbeafdeeda39:pretesting"
          ]
        },
        {
          "ruleId": "method_decision_evidence_adapter_v2",
          "result": "authorized_context_applied",
          "reason": "Only structured learner declarations and exact route-bound outcomes allowed by the learner's personalization controls entered method routing.",
          "evidenceRefs": []
        },
        {
          "ruleId": "method_evidence_v1",
          "result": "thresholded_outcome_evidence",
          "reason": "Method outcomes can rank an eligible method only after the versioned session, checked-answer, and distinct-study-day evidence minimums are met.",
          "evidenceRefs": []
        },
        {
          "ruleId": "method_compare_v1",
          "result": "comparison_context_required",
          "reason": "Outcome evidence may enter method routing only after the versioned task, stage, mode, environment, difficulty, duration, support, target-relationship, and assessment context matches.",
          "evidenceRefs": []
        },
        {
          "ruleId": "method_eligibility_v2",
          "result": "worked_example_fading,pretesting,self_explanation",
          "reason": "Task, knowledge stage, and Learn mode limited selection to Worked Examples, Pretesting, Feynman Technique.",
          "evidenceRefs": []
        },
        {
          "ruleId": "canonical_method_selection_v1",
          "result": "learner_choice:pretesting",
          "reason": "You chose Pretesting from the methods that fit this session.",
          "evidenceRefs": [
            "learner-choice:committed-route:04d6a366-7743-477c-9e2b-7cde66f2e2ed:b28be17e-d9bb-4642-af60-e1be56f5928e:5fc5b507-f9e8-45c3-8b45-cbeafdeeda39:pretesting"
          ]
        },
        {
          "ruleId": "method_runtime_capability_v1",
          "result": "full:validated_phase_contract:recovery_none",
          "reason": "YOVA can deliver this route through full generation and the generic activity renderer under the method's validated phase contract. If primary generation fails, YOVA must retry or show recovery instead of relabeling a generic fallback as this method.",
          "evidenceRefs": []
        },
        {
          "ruleId": "method_presentation_v2",
          "result": "recognizable_method_names",
          "reason": "Learner-facing method names come from the versioned presentation catalog; method IDs and learning recipes remain unchanged.",
          "evidenceRefs": []
        },
        {
          "ruleId": "study_route_agency_mode_controller_v1",
          "result": "ill_customize:learner_choice:alternatives:worked_example_fading",
          "reason": "The learner chose this exact route-bound method, so the shared agency controller recorded learner customization and kept at most two eligible, deliverable alternatives.",
          "evidenceRefs": [
            "learner-choice:committed-route:04d6a366-7743-477c-9e2b-7cde66f2e2ed:b28be17e-d9bb-4642-af60-e1be56f5928e:5fc5b507-f9e8-45c3-8b45-cbeafdeeda39:pretesting"
          ]
        },
        {
          "ruleId": "study_route.material_successor",
          "result": "created_provisional_successor",
          "reason": "The learner changed this ready session from Worked Examples to Pretesting.",
          "evidenceRefs": []
        }
      ]
    }
  }
  $route$::jsonb
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'agency-boundary-pgtap@yova.invalid',
  '',
  '2026-08-24T11:00:00.000Z',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  '2026-08-24T11:00:00.000Z',
  '2026-08-24T11:00:00.000Z'
);

insert into public.learning_items (
  id,
  user_id,
  title,
  kind,
  topic,
  status,
  source_mode,
  study_mode
) values (
  '53fc3137-d0de-4d64-b674-d5f5a80d267d',
  '11111111-1111-4111-8111-111111111111',
  'Agency boundary fixture',
  'course',
  'Product rule',
  'active',
  'yova_generated',
  'inside_yova'
);

insert into public.plans (
  id,
  user_id,
  learning_item_id,
  status,
  rationale
) values (
  '04d6a366-7743-477c-9e2b-7cde66f2e2ed',
  '11111111-1111-4111-8111-111111111111',
  '53fc3137-d0de-4d64-b674-d5f5a80d267d',
  'active',
  'Exercise the exact hidden eligible method authorization boundary.'
);

insert into public.plan_sessions (
  id,
  user_id,
  plan_id,
  sequence,
  title,
  objective,
  method,
  method_rationale,
  scheduled_for,
  estimated_minutes,
  status,
  step_data
) values (
  'b28be17e-d9bb-4642-af60-e1be56f5928e',
  '11111111-1111-4111-8111-111111111111',
  '04d6a366-7743-477c-9e2b-7cde66f2e2ed',
  1,
  'Build a first model of the product-rule structure',
  'Build an accurate first mental model of The product rule for derivatives through a concise explanation and one concrete example.',
  'Worked Examples',
  'The fixture baseline is eligible for this exact session.',
  '2026-08-24T19:00:00.000Z',
  25,
  'ready',
  $step$
  {
    "learningMode": "learn",
    "topicIds": ["b74d81a4-18ae-4f12-9ec8-7f133e3e5309"],
    "completionEvidence": [
      "Explain the central relationship in plain language after the model is hidden",
      "Produce evidence for each listed content target"
    ]
  }
  $step$::jsonb
);

do $block$
declare
  fixture agency_other_method_fixture%rowtype;
begin
  select * into fixture from agency_other_method_fixture;
  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    fixture.user_id::text,
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
  perform public.commit_study_route_revision(fixture.predecessor);
end;
$block$;

select extensions.is(
  (
    select public.change_plan_session_method_with_route(
      pg_catalog.jsonb_build_object(
        'planId', fixture.plan_id,
        'planSessionId', fixture.session_id,
        'expectedRouteRevisionId',
          fixture.predecessor #>> '{identity,routeRevisionId}',
        'selectionScope', 'other_eligible_method',
        'successorStudyRoute', fixture.successor
      )
    ) #>> '{status}'
    from agency_other_method_fixture as fixture
  ),
  'updated',
  'an HTTP-equivalent Other-method payload commits a hidden method from the immutable eligible cohort'
);

select extensions.is(
  (
    select route.route_payload #>> '{approach,primaryMethodId}'
    from public.study_routes as route
    where route.route_revision_id =
      '91000000-0000-4000-8000-000000000002'
      and route.lifecycle = 'committed'
  ),
  'pretesting',
  'the hidden eligible method becomes the exact committed immutable successor'
);

select extensions.throws_ok(
  $statement$
    select public.change_plan_session_method_with_route(
      pg_catalog.jsonb_build_object(
        'planId', fixture.plan_id,
        'planSessionId', fixture.session_id,
        'expectedRouteRevisionId',
          fixture.predecessor #>> '{identity,routeRevisionId}',
        'selectionScope', 'all_methods',
        'successorStudyRoute', fixture.successor
      )
    )
    from agency_other_method_fixture as fixture
  $statement$,
  '22023',
  'post_commit_method_choice_scope_conflict',
  'a forged selection scope cannot widen the stable RPC'
);

-- A distinct v3 predecessor proves that the stable adapter keeps v2 routes
-- on v2 while dispatching newly issued routes through the additive v3 writer.
create temporary table agency_v3_method_fixture (
  user_id uuid not null,
  plan_id uuid not null,
  learning_item_id uuid not null,
  session_id uuid not null,
  predecessor jsonb not null,
  successor jsonb not null
) on commit drop;

insert into agency_v3_method_fixture
select
  fixture.user_id,
  '14000000-0000-4000-8000-000000000001'::uuid,
  fixture.learning_item_id,
  '14000000-0000-4000-8000-000000000002'::uuid,
  pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.replace(
            fixture.predecessor::text,
            fixture.plan_id::text,
            '14000000-0000-4000-8000-000000000001'
          ),
          fixture.session_id::text,
          '14000000-0000-4000-8000-000000000002'
        ),
        'a2f090cf-b3fe-4c2a-ad46-632ced029095',
        '14000000-0000-4000-8000-000000000003'
      ),
      '5fc5b507-f9e8-45c3-8b45-cbeafdeeda39',
      '14000000-0000-4000-8000-000000000004'
    ),
    'method_eligibility_v2',
    'method_eligibility_v3'
  )::jsonb,
  pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.replace(
            pg_catalog.replace(
              fixture.successor::text,
              fixture.plan_id::text,
              '14000000-0000-4000-8000-000000000001'
            ),
            fixture.session_id::text,
            '14000000-0000-4000-8000-000000000002'
          ),
          'a2f090cf-b3fe-4c2a-ad46-632ced029095',
          '14000000-0000-4000-8000-000000000003'
        ),
        '5fc5b507-f9e8-45c3-8b45-cbeafdeeda39',
        '14000000-0000-4000-8000-000000000004'
      ),
      '91000000-0000-4000-8000-000000000002',
      '14000000-0000-4000-8000-000000000005'
    ),
    'method_eligibility_v2',
    'method_eligibility_v3'
  )::jsonb
from agency_other_method_fixture as fixture;

insert into agency_v3_method_fixture
with current_format as (
  select
    fixture.user_id,
    fixture.learning_item_id,
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.replace(
            fixture.predecessor::text,
            fixture.plan_id::text,
            '15000000-0000-4000-8000-000000000001'
          ),
          fixture.session_id::text,
          '15000000-0000-4000-8000-000000000002'
        ),
        'a2f090cf-b3fe-4c2a-ad46-632ced029095',
        '15000000-0000-4000-8000-000000000003'
      ),
      '5fc5b507-f9e8-45c3-8b45-cbeafdeeda39',
      '15000000-0000-4000-8000-000000000004'
    )::jsonb as predecessor,
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.replace(
            pg_catalog.replace(
              fixture.successor::text,
              fixture.plan_id::text,
              '15000000-0000-4000-8000-000000000001'
            ),
            fixture.session_id::text,
            '15000000-0000-4000-8000-000000000002'
          ),
          'a2f090cf-b3fe-4c2a-ad46-632ced029095',
          '15000000-0000-4000-8000-000000000003'
        ),
        '5fc5b507-f9e8-45c3-8b45-cbeafdeeda39',
        '15000000-0000-4000-8000-000000000004'
      ),
      '91000000-0000-4000-8000-000000000002',
      '15000000-0000-4000-8000-000000000005'
    )::jsonb as successor
  from agency_other_method_fixture as fixture
), agency_marker as (
  select $trace$
    {
      "ruleId": "study_route_agency_mode_controller_v1",
      "result": "ill_customize:legacy_current_format",
      "reason": "The stored predecessor records the current agency contract but predates explicit eligibility provenance.",
      "evidenceRefs": []
    }
  $trace$::jsonb as value
)
select
  current_format.user_id,
  '15000000-0000-4000-8000-000000000001'::uuid,
  current_format.learning_item_id,
  '15000000-0000-4000-8000-000000000002'::uuid,
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      current_format.predecessor,
      '{provenance,ruleTrace,0}',
      agency_marker.value
    ),
    '{agency,alternatives}',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'alternativeId', 'method-alternative:pretesting',
        'mode', 'learn',
        'executionEnvironment', 'inside_yova',
        'primaryMethodId', 'pretesting',
        'visibleMethodName', 'Pretesting',
        'activeMinutes', 25,
        'tradeoff', public.study_route_method_tradeoff_v2(
          current_format.predecessor,
          'pretesting'
        )
      )
    )
  ),
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      current_format.successor,
      '{provenance,ruleTrace,0}',
      agency_marker.value
    ),
    '{provenance,ruleTrace,1,reason}',
    pg_catalog.to_jsonb(
      'The learner changed the exact ready session to one of the bounded methods saved on its committed route.'::text
    )
  )
from current_format
cross join agency_marker;

insert into public.plans (
  id,
  user_id,
  learning_item_id,
  status,
  rationale
)
select
  fixture.plan_id,
  fixture.user_id,
  fixture.learning_item_id,
  'active',
  'Exercise stored-predecessor dispatch for eligibility v3.'
from agency_v3_method_fixture as fixture;

insert into public.plan_sessions (
  id,
  user_id,
  plan_id,
  sequence,
  title,
  objective,
  method,
  method_rationale,
  scheduled_for,
  estimated_minutes,
  status,
  step_data
)
select
  fixture.session_id,
  fixture.user_id,
  fixture.plan_id,
  1,
  'Build a first model through eligibility v3',
  fixture.predecessor #>> '{target,desiredOutcome}',
  fixture.predecessor #>> '{approach,visibleMethodName}',
  fixture.predecessor #>> '{explanation,shortReason}',
  '2026-08-24T20:00:00.000Z',
  (fixture.predecessor #>> '{timing,activeMinutes}')::integer,
  'ready',
  pg_catalog.jsonb_build_object(
    'learningMode', case fixture.predecessor #>> '{approach,mode}'
      when 'learn' then 'learn'
      when 'practice' then 'study'
      else null
    end,
    'topicIds', public.study_route_active_topic_ids_v1(
      fixture.predecessor
    ),
    'completionEvidence', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(evidence.value ->> 'description')
          order by evidence.ordinality
        ),
        '[]'::jsonb
      )
      from pg_catalog.jsonb_array_elements(
        fixture.predecessor #> '{execution,completionEvidence}'
      ) with ordinality as evidence(value, ordinality)
    )
  )
from agency_v3_method_fixture as fixture;

do $block$
declare
  fixture agency_v3_method_fixture%rowtype;
begin
  for fixture in select * from agency_v3_method_fixture
  loop
    perform public.commit_study_route_revision(fixture.predecessor);
  end loop;
end;
$block$;

select extensions.throws_ok(
  $statement$
    select public.change_plan_session_method_with_route(
      pg_catalog.jsonb_build_object(
        'planId', fixture.plan_id,
        'planSessionId', fixture.session_id,
        'expectedRouteRevisionId',
          fixture.predecessor #>> '{identity,routeRevisionId}',
        'selectionScope', 'other_eligible_method',
        'successorStudyRoute', pg_catalog.jsonb_set(
          fixture.successor,
          '{provenance,ruleTrace,5,ruleId}',
          '"method_eligibility_v2"'::jsonb
        )
      )
    )
    from agency_v3_method_fixture as fixture
    where fixture.plan_id = '14000000-0000-4000-8000-000000000001'
  $statement$,
  '22023',
  'post_commit_method_choice_agency_conflict',
  'a v3 predecessor rejects a successor that tries to downgrade its appended eligibility trace'
);

select extensions.is(
  (
    select public.change_plan_session_method_with_route(
      pg_catalog.jsonb_build_object(
        'planId', fixture.plan_id,
        'planSessionId', fixture.session_id,
        'expectedRouteRevisionId',
          fixture.predecessor #>> '{identity,routeRevisionId}',
        'selectionScope', 'other_eligible_method',
        'successorStudyRoute', fixture.successor
      )
    ) #>> '{status}'
    from agency_v3_method_fixture as fixture
    where fixture.plan_id = '14000000-0000-4000-8000-000000000001'
  ),
  'updated',
  'a stored v3 predecessor dispatches to the private v3 writer'
);

select extensions.is(
  (
    select route.route_payload #>> '{provenance,ruleTrace,5,ruleId}'
    from public.study_routes as route
    where route.route_revision_id =
      '14000000-0000-4000-8000-000000000005'
      and route.lifecycle = 'committed'
  ),
  'method_eligibility_v3',
  'the exact v3 successor is committed without reinterpreting its eligibility policy'
);

select extensions.is(
  (
    select public.change_plan_session_method_with_route(
      pg_catalog.jsonb_build_object(
        'planId', fixture.plan_id,
        'planSessionId', fixture.session_id,
        'expectedRouteRevisionId',
          fixture.predecessor #>> '{identity,routeRevisionId}',
        'selectionScope', 'stored_alternative',
        'successorStudyRoute', fixture.successor
      )
    ) #>> '{status}'
    from agency_v3_method_fixture as fixture
    where fixture.plan_id = '15000000-0000-4000-8000-000000000001'
  ),
  'updated',
  'a current-format no-trace predecessor keeps its exact stored alternative on frozen v2 semantics'
);

select extensions.is(
  (
    select route.route_payload #>> '{provenance,ruleTrace,5,ruleId}'
    from public.study_routes as route
    where route.route_revision_id =
      '15000000-0000-4000-8000-000000000005'
      and route.lifecycle = 'committed'
  ),
  'method_eligibility_v2',
  'the no-trace compatibility successor records v2 instead of being widened to v3'
);

-- A Pretesting check is diagnostic baseline information. Even a correct
-- pretest must not advance the durable topic map; a later repair/transfer
-- check remains authoritative.
insert into public.learning_items (
  id,
  user_id,
  title,
  kind,
  topic,
  status,
  source_mode,
  study_mode
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Pretesting evidence boundary',
  'topic',
  'Pretest topic',
  'active',
  'yova_generated',
  'inside_yova'
);

insert into public.plans (
  id,
  user_id,
  learning_item_id,
  status,
  rationale,
  knowledge_map
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'active',
  'Exercise the database-side Pretesting evidence exclusion.',
  $map$
  {
    "version": 1,
    "topics": [{
      "id": "12345678-1234-4234-8234-123456789abc",
      "label": "Pretest topic",
      "status": "not_started"
    }]
  }
  $map$::jsonb
);

insert into public.plan_sessions (
  id,
  user_id,
  plan_id,
  sequence,
  title,
  objective,
  method,
  method_rationale,
  estimated_minutes,
  status,
  step_data
) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '11111111-1111-4111-8111-111111111111',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  1,
  'Pretest then teach',
  'Measure the baseline, build the model, and repair the exact gap.',
  'Pretesting',
  'Pretesting establishes a baseline before teaching and repair.',
  25,
  'complete',
  $step$
  {
    "learningMode": "learn",
    "topicIds": ["12345678-1234-4234-8234-123456789abc"],
    "generatedSession": {
      "topicIds": ["12345678-1234-4234-8234-123456789abc"]
    }
  }
  $step$::jsonb
);

insert into public.session_attempts (
  id,
  user_id,
  plan_session_id,
  completed_at,
  result_data
) values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '11111111-1111-4111-8111-111111111111',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '2026-08-24T13:00:00.000Z',
  $result$
  {
    "completionMode": "guided",
    "conceptEvidence": [{
      "topicId": "12345678-1234-4234-8234-123456789abc",
      "concept": "Pretest topic",
      "outcome": "secure",
      "activityType": "multiple_choice",
      "methodPhase": "pretest"
    }]
  }
  $result$::jsonb
);

select public.refresh_plan_knowledge_map_topic_statuses(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111'
);

select extensions.is(
  (
    select plan.knowledge_map #>> '{topics,0,status}'
    from public.plans as plan
    where plan.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  'not_started',
  'a secure pretest result does not advance durable topic status'
);

insert into public.session_attempts (
  id,
  user_id,
  plan_session_id,
  completed_at,
  result_data
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '11111111-1111-4111-8111-111111111111',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '2026-08-24T13:01:00.000Z',
  $result$
  {
    "completionMode": "guided",
    "conceptEvidence": [{
      "topicId": "12345678-1234-4234-8234-123456789abc",
      "concept": "Pretest topic",
      "outcome": "needs_review",
      "activityType": "multiple_choice",
      "methodPhase": "pretest"
    }]
  }
  $result$::jsonb
);

select public.refresh_plan_knowledge_map_topic_statuses(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111'
);

select extensions.is(
  (
    select plan.knowledge_map #>> '{topics,0,status}'
    from public.plans as plan
    where plan.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  'not_started',
  'a missed pretest result also does not advance durable topic status'
);

insert into public.session_attempts (
  id,
  user_id,
  plan_session_id,
  completed_at,
  result_data
) values (
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  '11111111-1111-4111-8111-111111111111',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '2026-08-24T13:02:00.000Z',
  $result$
  {
    "completionMode": "guided",
    "conceptEvidence": [{
      "topicId": "12345678-1234-4234-8234-123456789abc",
      "concept": "Pretest topic",
      "outcome": "needs_review",
      "activityType": "free_response",
      "methodPhase": "repair"
    }]
  }
  $result$::jsonb
);

select public.refresh_plan_knowledge_map_topic_statuses(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111'
);

select extensions.is(
  (
    select plan.knowledge_map #>> '{topics,0,status}'
    from public.plans as plan
    where plan.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  'evidenced',
  'a later authoritative repair check advances durable topic status'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.signed_in_generation_readiness_v2()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.signed_in_generation_readiness_v2()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.signed_in_generation_readiness_v2()',
    'execute'
  )
  and (
    select routine.prosecdef and routine.provolatile = 's'
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.signed_in_generation_readiness_v2()'
    )
  ),
  'the expanded readiness contract is stable, security-definer, and service-role-only'
);

select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.signed_in_generation_readiness_v3()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.signed_in_generation_readiness_v3()',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.signed_in_generation_readiness_v3()',
    'execute'
  )
  and (
    select routine.prosecdef and routine.provolatile = 's'
    from pg_catalog.pg_proc as routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.signed_in_generation_readiness_v3()'
    )
  ),
  'the eligibility-v3 readiness contract is stable, security-definer, and service-role-only'
);

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );
end;
$block$;

select extensions.is(
  public.signed_in_generation_readiness_v2(),
  pg_catalog.jsonb_build_object(
    'contractVersion', '202608300003',
    'ready', true,
    'studyRoutesSchema', true,
    'planSessionsRoutePointer', true,
    'requiredRouteRpcs', true,
    'expandedMethodAgencyBoundary', true
  ),
  'the migration head certifies the expanded method and agency boundary'
);

select extensions.is(
  public.signed_in_generation_readiness_v3(),
  pg_catalog.jsonb_build_object(
    'contractVersion', '202608310003',
    'ready', true,
    'studyRoutesSchema', true,
    'planSessionsRoutePointer', true,
    'requiredRouteRpcs', true,
    'expandedMethodAgencyBoundary', true,
    'methodEligibilityV3Boundary', true
  ),
  'the migration head certifies the immutable eligibility-v3 boundary'
);

do $block$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'authenticated',
    true
  );
end;
$block$;

select extensions.throws_ok(
  'select public.signed_in_generation_readiness_v2()',
  '42501',
  'signed_in_generation_readiness_service_role_required',
  'an authenticated learner cannot invoke the expanded deployment probe'
);

select extensions.throws_ok(
  'select public.signed_in_generation_readiness_v3()',
  '42501',
  'signed_in_generation_readiness_service_role_required',
  'an authenticated learner cannot invoke the eligibility-v3 deployment probe'
);

select * from extensions.finish();
rollback;
