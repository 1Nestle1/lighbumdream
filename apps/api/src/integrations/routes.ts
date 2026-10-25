import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ConnectIntegrationBody, INTEGRATION_PROVIDERS, type IntegrationsResponse } from "@lightbulb/shared";
import { requireUser } from "../auth/session.js";
import { connectIntegration, disconnectIntegration, listIntegrations } from "./service.js";

const Params = z.object({ provider: z.enum(INTEGRATION_PROVIDERS) });
const provider = (request: FastifyRequest) => Params.parse(request.params).provider;

export async function integrationRoutes(app: FastifyInstance) {
  app.get("/integrations", async (request): Promise<IntegrationsResponse> =>
    listIntegrations(requireUser(request).id),
  );

  // Each attempt calls the provider to check the key, so keep guessing slow.
  app.put(
    "/integrations/:provider",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
        },
      },
    },
    async (request) => {
      const { secret } = ConnectIntegrationBody.parse(request.body);
      return connectIntegration(requireUser(request).id, provider(request), secret);
    },
  );

  app.delete("/integrations/:provider", async (request, reply) => {
    await disconnectIntegration(requireUser(request).id, provider(request));
    return reply.status(204).send();
  });
}
