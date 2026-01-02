# CLAUDE_PRD.md - Product Requirements Document Generator Prompt

Use this prompt template with Claude to generate a comprehensive PRD for a new project. Copy and customize the sections below based on your project needs.

---

## PRD Generation Prompt

```markdown
# Generate a Product Requirements Document (PRD)

I need you to help me create a comprehensive Product Requirements Document for my new project. Please guide me through each section and help me think through the requirements thoroughly.

## Project Overview

**Project Name:** [Your project name]

**One-line Description:** [Brief description - what does this product do?]

**Problem Statement:**
[Describe the problem you're solving. Who has this problem? Why does it matter?]

**Target Users:**
[Who will use this product? Be specific about user personas]

**Success Metrics:**
[How will you measure if this product is successful?]

---

## Core Requirements

### Functional Requirements

Please help me define the core functionality. For each feature, I need:
1. User story format: "As a [user type], I want to [action] so that [benefit]"
2. Acceptance criteria
3. Priority (P0 = must-have, P1 = important, P2 = nice-to-have)

**Feature Categories to Consider:**
- User Authentication & Authorization
- Core Business Logic
- Data Management
- Integrations (APIs, third-party services)
- Notifications & Alerts
- Reporting & Analytics
- Admin/Management Functions

### Non-Functional Requirements

Help me think through:
- **Performance:** Response times, throughput, concurrent users
- **Scalability:** Expected growth, scaling strategy
- **Security:** Authentication, authorization, data protection, compliance
- **Reliability:** Uptime requirements, disaster recovery
- **Accessibility:** WCAG compliance level
- **Internationalization:** Languages, locales, time zones

---

## Technical Architecture

### Recommended Tech Stack

Based on my requirements, recommend a tech stack considering:

**Frontend Options:**
- Framework: React, Vue, Svelte, Next.js, etc.
- Styling: Tailwind CSS, CSS-in-JS, component libraries
- State Management: React Query, Redux, Zustand, etc.
- Build Tool: Vite, Webpack, etc.

**Backend Options:**
- Runtime: Node.js, Deno, Python, Go, etc.
- Framework: Express, Fastify, Django, FastAPI, etc.
- Database: PostgreSQL, MongoDB, etc.
- ORM/Query Builder: Prisma, Drizzle, TypeORM, etc.

**Infrastructure Options:**
- Hosting: Vercel, AWS, GCP, Supabase, etc.
- Serverless Functions: Edge functions, Lambda, Cloud Functions
- CDN & Caching strategy
- CI/CD pipeline

**For IoT/Hardware Projects (if applicable):**
- Communication protocols: LoRaWAN, MQTT, HTTP, WebSocket
- Device management platform
- Telemetry ingestion pipeline
- Real-time data streaming

### Data Architecture

Help me design:
- Core database schema
- Data relationships and constraints
- Multi-tenancy approach (if needed)
- Row-Level Security (RLS) policies
- Caching strategy
- Data retention policies

### API Design

- REST vs GraphQL decision
- API versioning strategy
- Authentication method (JWT, API keys, OAuth)
- Rate limiting approach
- Error response format

---

## User Interface Design

### Page/Screen Inventory

List all major screens needed:
1. [Screen name] - [Purpose]
2. [Screen name] - [Purpose]
...

### UI/UX Requirements

- Design system approach (custom vs. component library like shadcn-ui)
- Responsive design breakpoints
- Dark mode support
- Loading states and error handling
- Accessibility requirements
- Animation/interaction patterns

### Navigation Structure

- Primary navigation
- Secondary navigation
- User flows for key tasks

---

## Integrations

### Third-Party Services

For each integration needed:
- Service name and purpose
- API documentation link
- Authentication method
- Data flow (inbound/outbound)
- Error handling strategy
- Rate limits and quotas

### Webhook Requirements

If applicable:
- Webhook endpoints to expose
- Webhook endpoints to consume
- Retry logic and idempotency
- Signature verification

---

## Security Requirements

### Authentication

- Login methods (email/password, SSO, OAuth providers)
- Multi-factor authentication
- Session management
- Password policies

### Authorization

- Role-based access control (RBAC) design
- Permission levels
- Resource-level permissions
- Multi-tenant isolation

### Data Protection

- Encryption at rest and in transit
- PII handling
- Audit logging
- Compliance requirements (GDPR, HIPAA, SOC2, etc.)

---

## Testing Strategy

### Testing Pyramid

- Unit testing approach and coverage targets
- Integration testing strategy
- End-to-end testing approach
- Performance testing plan
- Security testing (penetration testing, vulnerability scanning)

### Recommended Testing Tools

Based on the tech stack, recommend:
- Unit test framework
- Component testing library
- E2E testing framework
- API testing tools
- Performance testing tools

---

## Development & Deployment

### Development Workflow

- Git branching strategy
- Code review process
- CI/CD pipeline stages
- Environment strategy (dev, staging, production)

### Monitoring & Observability

- Application performance monitoring (APM)
- Error tracking
- Logging strategy
- Alerting thresholds
- Dashboard requirements

### Documentation

- API documentation approach
- User documentation
- Developer onboarding docs
- Runbooks for operations

---

## Project Planning

### MVP Scope

Define the minimum viable product:
- Must-have features for launch
- Features to defer to v2
- Technical debt acceptable for MVP

### Milestones

Help me break this into phases:
1. Phase 1: [Core functionality]
2. Phase 2: [Enhanced features]
3. Phase 3: [Scale and optimize]

### Risk Assessment

Identify potential risks:
- Technical risks
- Integration risks
- Resource risks
- Timeline risks

For each risk: likelihood, impact, mitigation strategy

---

## Output Format

Please generate the PRD in a structured format with:
1. Executive summary (1 paragraph)
2. Detailed requirements by section
3. Technical recommendations with rationale
4. Open questions that need stakeholder input
5. Suggested next steps

Include diagrams where helpful:
- System architecture diagram (describe in text/mermaid)
- Data flow diagrams
- User flow diagrams
- ER diagrams for database schema
```

---

## Quick Start Variations

### For a SaaS Web Application

```markdown
Generate a PRD for a SaaS [describe your app] with:
- Multi-tenant architecture
- Subscription billing (Stripe integration)
- User roles: Admin, Manager, Member
- React + TypeScript frontend with Tailwind
- Supabase backend (PostgreSQL + Edge Functions)
- Real-time features using Supabase Realtime
```

### For an IoT/Hardware Project

```markdown
Generate a PRD for an IoT [describe your device/system] with:
- Device fleet management
- Real-time telemetry ingestion
- [Protocol: LoRaWAN/MQTT/HTTP] integration
- Alert thresholds and notifications
- Historical data visualization
- Multi-site/multi-tenant support
```

### For a Mobile App

```markdown
Generate a PRD for a mobile app that [describe purpose] with:
- Cross-platform (React Native / Flutter)
- Offline-first architecture
- Push notifications
- [Specific integrations: maps, camera, payments, etc.]
- Backend API requirements
```

### For an API/Developer Platform

```markdown
Generate a PRD for a developer platform/API that [describe purpose] with:
- RESTful API design
- API key management
- Rate limiting tiers
- Webhook system
- Developer documentation portal
- SDK requirements (JS, Python, etc.)
```

---

## Example: FrostGuard-Style IoT Project PRD Prompt

Based on the FrostGuard project pattern, here's a complete example prompt:

```markdown
Generate a comprehensive PRD for a cold chain monitoring system with:

## Overview
- **Purpose:** Monitor temperature and humidity in refrigeration units for food safety compliance
- **Users:** Facility managers, compliance officers, maintenance staff
- **Scale:** Multi-site deployments with 10-1000 sensors per site

## Technical Requirements
- **Frontend:** React 18 + TypeScript + Vite + shadcn-ui + Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Deno Edge Functions)
- **IoT Protocol:** LoRaWAN via The Things Network (TTN)
- **Real-time:** Supabase Realtime for live telemetry

## Core Features
1. Device provisioning and management
2. Real-time telemetry dashboard
3. Alert configuration and notifications
4. Historical data and reporting
5. Multi-tenant organization hierarchy
6. Compliance report generation

## Integrations
- The Things Network v3 API
- Email/SMS notifications
- Export to CSV/PDF

## Security
- Row-Level Security (RLS) for multi-tenancy
- Role-based access control
- Audit logging for compliance

Please generate:
1. Detailed feature specifications with user stories
2. Database schema design with RLS policies
3. Edge function architecture
4. API endpoint inventory
5. UI component hierarchy
6. Testing strategy
7. Deployment checklist
```

---

## Tips for Better PRDs

1. **Be specific about constraints** - Budget, timeline, team size, existing systems
2. **Define "done"** - Clear acceptance criteria for each feature
3. **Prioritize ruthlessly** - Not everything is P0
4. **Consider edge cases** - Error states, empty states, high load scenarios
5. **Plan for observability** - How will you know if something breaks?
6. **Think about operations** - Who maintains this? What happens at 3 AM?
7. **Document decisions** - Why did you choose X over Y?

---

## Next Steps After PRD

Once you have your PRD, use it to:
1. Create a `CLAUDE.md` file for your new project
2. Set up the initial project structure
3. Create GitHub issues from the feature specs
4. Begin implementation with clear context
