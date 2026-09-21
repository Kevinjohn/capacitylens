import { RESOURCE_AVATAR_URL_V42_PIN } from "./resourceAvatarUrlV42";
import { ACCOUNT_MEMBER_RESOURCES_V43_PIN } from "./accountMemberResourcesV43";
import { INVITATION_PERSON_PROPOSALS_V44_PIN } from "./invitationPersonProposalsV44";
import { GETTING_STARTED_DISMISSALS_V45_PIN } from "./gettingStartedDismissalsV45";

/** Pending app migrations asserted before authentication DDL runs. */
export const CHECKSUM_PINNED_MIGRATIONS = [
  {
    version: 35,
    name: "add-allocation-project-id",
    checksum: "19c2729bf7048ca0a3e317f3d00088b29c7c7c2cd4d60febce28146d1c42c9a3",
  },
  {
    version: 36,
    name: "add-activity-lifecycle",
    checksum: "84f944631288597d07740bd183ae549486c68dd642c001bced8108bc1c11b1f2",
  },
  {
    version: 37,
    name: "add-allocation-task-field",
    checksum: "4258d2a701763cfe75ace2ab25f30ef1d0a242b7e42927e98fe582106e8c1480",
  },
  {
    version: 38,
    name: "add-resource-availability-dates",
    checksum: "b3d53dc7052721fe8f6b2f9c7164ffabea06c0b10acc59792b474337fc2619dc",
  },
  {
    version: 39,
    name: "add-capacity-overview-access",
    checksum: "098f2980febe986613c549b5f1a48c003d17528c34ea3c7deec706d6afdbae45",
  },
  {
    version: 40,
    name: "add-account-date-style",
    checksum: "5523524112cbd00936ed3fff90c0e00e142472abf78122e39dbc32f3bf59e2cc",
  },
  {
    version: 41,
    name: "add-ownership-transfer-requests",
    checksum: "d9dc51a48af818e1ccefcbb0fa0d7a703258c9149545f8cc62eaef5c6a5015e7",
  },
  RESOURCE_AVATAR_URL_V42_PIN,
  ACCOUNT_MEMBER_RESOURCES_V43_PIN,
  INVITATION_PERSON_PROPOSALS_V44_PIN,
  GETTING_STARTED_DISMISSALS_V45_PIN,
];
