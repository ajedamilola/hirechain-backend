import { v4 as uuidv4 } from 'uuid';
import { connectDB, disconnectDB } from '../db/connection.js';
import {
  Profile,
  Gig,
  Message,
  XP,
  Reward,
  Application,
  Invitation,
  Review,
} from '../db/models.js';

// Simple helpers (no external libs)
const randItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p) => Math.random() < p;

const skillsPool = [
  'Solidity', 'Ethers.js', 'Web3.js', 'Hardhat', 'Foundry', 'Rust', 'Move',
  'React', 'Next.js', 'Node.js', 'Express', 'MongoDB', 'GraphQL', 'Docker', 'Kubernetes'
];

const projectTitles = [
  'Build NFT Marketplace',
  'DeFi Yield Aggregator',
  'Smart Contract Audit',
  'DAO Governance Portal',
  'Hedera-based Escrow DApp',
  'Payment Channel Integration',
  'Chain Indexer Service',
  'Subgraph Development',
  'Wallet Integration',
  'Cross-chain Bridge POC'
];

const lorem = [
  'Looking for an experienced web3 dev to implement core features.',
  'We need secure and gas-efficient contracts with full test coverage.',
  'Prior experience with Hedera and HCS is a plus.',
  'Deliverables include docs, tests, and basic CI.',
  'Please include examples of previous smart contract work.'
];

const names = [
  'Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi',
  'Ivan', 'Judy', 'Mallory', 'Niaj', 'Olivia', 'Peggy', 'Sybil', 'Trent'
];

const roles = [
  "freelancer", "hirer"
]

async function seed() {
  await connectDB();
  console.log('Seeding mock data...');

  // 1) Clean slate
  await Promise.all([
    Profile.deleteMany({}),
    Gig.deleteMany({}),
    Message.deleteMany({}),
    XP.deleteMany({}),
    Reward.deleteMany({}),
    Application.deleteMany({}),
    Invitation.deleteMany({}),
    Review.deleteMany({}),
  ]);

  // 2) Create Profiles (clients + freelancers)
  const clients = [];
  const freelancers = [];
  const profiles = [];

  // 4 clients, 10 freelancers
  const clientCount = 4;
  const freelancerCount = 10;

  // generate unique account ids (strings)
  const genAccountId = () => `0.0.${randInt(100000, 999999)}`;

  const usedIds = new Set();
  const uniqueAccountId = () => {
    let id = genAccountId();
    while (usedIds.has(id)) id = genAccountId();
    usedIds.add(id);
    return id;
  };

  const randomSkills = () => {
    const n = randInt(3, 6);
    const picks = new Set();
    while (picks.size < n) picks.add(randItem(skillsPool));
    return Array.from(picks);
  };

  const allNames = [...names];
  while (allNames.length < clientCount + freelancerCount) {
    allNames.push(`User${allNames.length + 1}`);
  }

  for (let i = 0; i < clientCount; i++) {
    const userAccountId = uniqueAccountId();
    const name = allNames[i];
    const email = `${name.toLowerCase()}@client.example.com`;
    const p = {
      userAccountId,
      name: `${name} (Client)`,
      skills: randomSkills(),
      portfolioUrl: `https://portfolio.example.com/${name.toLowerCase()}`,
      email,
      profileType: randItem(roles)
    };
    clients.push(p);
    profiles.push(p);
  }

  for (let i = 0; i < freelancerCount; i++) {
    const userAccountId = uniqueAccountId();
    const name = allNames[clientCount + i];
    const email = `${name.toLowerCase()}@freelancer.example.com`;
    const p = {
      userAccountId,
      name: `${name} (Freelancer)`,
      skills: randomSkills(),
      portfolioUrl: `https://portfolio.example.com/${name.toLowerCase()}`,
      email,
    };
    freelancers.push(p);
    profiles.push(p);
  }

  await Profile.insertMany(profiles);
  console.log(`Inserted Profiles: ${profiles.length}`);

  // 3) XP and Rewards per user
  const rewardsDefs = [
    { id: 'BRONZE_BADGE', min: 100 },
    { id: 'SILVER_BADGE', min: 500 },
    { id: 'GOLD_BADGE', min: 2000 },
  ];

  const xpDocs = [];
  const rewardDocs = [];

  for (const p of profiles) {
    const xpPoints = randInt(0, 3000);
    xpDocs.push({ userAccountId: p.userAccountId, xpPoints });

    // Issue rewards based on thresholds
    for (const tier of rewardsDefs) {
      if (xpPoints >= tier.min && chance(0.8)) {
        rewardDocs.push({ userAccountId: p.userAccountId, rewardId: tier.id });
      }
    }
  }

  if (xpDocs.length) await XP.insertMany(xpDocs);
  if (rewardDocs.length) await Reward.insertMany(rewardDocs);
  console.log(`Inserted XP: ${xpDocs.length}, Rewards: ${rewardDocs.length}`);

  // 4) Create Gigs
  const gigs = [];
  const publicRatio = 0.7; // 70% public
  const totalGigs = 12;

  for (let i = 0; i < totalGigs; i++) {
    const client = randItem(clients);
    const isPublic = chance(publicRatio);
    const status = chance(0.15)
      ? 'COMPLETED'
      : chance(0.25)
        ? 'IN_PROGRESS'
        : 'OPEN';

    const assignedFreelancer = status !== 'OPEN' ? randItem(freelancers) : null;

    gigs.push({
      gigRefId: uuidv4(),
      clientId: client.userAccountId,
      title: randItem(projectTitles),
      description: `${randItem(lorem)} ${randItem(lorem)}`,
      budget: `${randInt(500, 10000)} HBAR`,
      duration: `${randInt(1, 12)} weeks`,
      visibility: isPublic ? 'PUBLIC' : 'PRIVATE',
      status,
      escrowContractId: null,
      assignedFreelancerId: assignedFreelancer ? assignedFreelancer.userAccountId : null,
    });
  }

  await Gig.insertMany(gigs);
  console.log(`Inserted Gigs: ${gigs.length}`);

  // 5) Applications (to OPEN gigs)
  const applications = [];
  for (const gig of gigs) {
    if (gig.status === 'OPEN') {
      const applicants = new Set();
      const applicantCount = randInt(2, 4);
      while (applicants.size < applicantCount) {
        const f = randItem(freelancers);
        if (f.userAccountId !== gig.clientId) applicants.add(f.userAccountId);
      }
      for (const freelancerId of applicants) {
        applications.push({
          gigRefId: gig.gigRefId,
          freelancerId,
          coverLetter: 'I am interested in this gig. I have relevant experience and can start immediately.',
          proposedRate: `${randInt(30, 120)} HBAR`,
          status: chance(0.2) ? 'ACCEPTED' : 'PENDING',
        });
      }
    }
  }
  if (applications.length) await Application.insertMany(applications);
  console.log(`Inserted Applications: ${applications.length}`);

  // 6) Invitations (for PRIVATE gigs)
  const invitations = [];
  for (const gig of gigs) {
    if (gig.visibility === 'PRIVATE') {
      const invitees = new Set();
      const inviteCount = randInt(2, 3);
      while (invitees.size < inviteCount) {
        const f = randItem(freelancers);
        if (f.userAccountId !== gig.clientId) invitees.add(f.userAccountId);
      }
      for (const freelancerId of invitees) {
        invitations.push({
          gigRefId: gig.gigRefId,
          freelancerId,
          message: 'Invitation to apply for a private engagement.',
          status: chance(0.2) ? 'ACCEPTED' : 'PENDING',
        });
      }
    }
  }
  if (invitations.length) await Invitation.insertMany(invitations);
  console.log(`Inserted Invitations: ${invitations.length}`);

  // 7) Messages per gig between client and assigned freelancer or applicants
  const messages = [];
  for (const gig of gigs) {
    const participants = new Set();
    participants.add(gig.clientId);

    if (gig.assignedFreelancerId) participants.add(gig.assignedFreelancerId);
    else {
      // use up to two applicants for OPEN gigs
      const cand = applications.filter(a => a.gigRefId === gig.gigRefId).slice(0, 2);
      for (const a of cand) participants.add(a.freelancerId);
    }

    const convo = Array.from(participants);
    if (convo.length > 1) {
      const msgCount = randInt(2, 5);
      for (let i = 0; i < msgCount; i++) {
        const senderId = randItem(convo);
        messages.push({
          gigRefId: gig.gigRefId,
          senderId,
          content: `Message ${i + 1} about: ${gig.title}`,
          timestamp: new Date(Date.now() - randInt(0, 7) * 24 * 3600 * 1000),
        });
      }
    }
  }
  if (messages.length) await Message.insertMany(messages);
  console.log(`Inserted Messages: ${messages.length}`);

  // 8) Reviews for completed gigs (both directions)
  const reviews = [];
  for (const gig of gigs) {
    if (gig.status === 'COMPLETED' && gig.assignedFreelancerId) {
      const rating1 = randInt(4, 5);
      const rating2 = randInt(4, 5);
      // Client -> Freelancer
      reviews.push({
        gigRefId: gig.gigRefId,
        reviewerId: gig.clientId,
        revieweeId: gig.assignedFreelancerId,
        rating: rating1,
        comment: 'Great collaboration and timely delivery.',
        reviewType: 'CLIENT_TO_FREELANCER',
      });
      // Freelancer -> Client
      reviews.push({
        gigRefId: gig.gigRefId,
        reviewerId: gig.assignedFreelancerId,
        revieweeId: gig.clientId,
        rating: rating2,
        comment: 'Clear requirements and prompt feedback/payment.',
        reviewType: 'FREELANCER_TO_CLIENT',
      });
    }
  }
  if (reviews.length) await Review.insertMany(reviews);
  console.log(`Inserted Reviews: ${reviews.length}`);

  console.log('✅ Seeding complete.');
}

seed()
  .catch((err) => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDB();
  });
