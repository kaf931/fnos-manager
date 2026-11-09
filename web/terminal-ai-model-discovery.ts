import type { ApiClient } from './contracts/shared.js';
import type { AiPublicProvider, AiModelOption } from './contracts/ai.js';
export const aiModelChoice = (providerId: string, model: string) =>
  JSON.stringify([providerId, model]);
export function createAiModelDiscovery(
  api: ApiClient,
  publish: (value: { providers: AiPublicProvider[]; models: AiModelOption[] }) => void,
  onError: (error: unknown) => void = () => {},
) {
  let serial = 0,
    disposed = false;
  return {
    async refresh() {
      const ticket = ++serial,
        current = () => !disposed && ticket === serial;
      try {
        const providers = await api<AiPublicProvider[]>('/terminal/ai/providers');
        if (!current()) return;
        const models = new Map(providers.map((p) => [p.id, [p.model]]));
        const update = () => {
          if (current())
            publish({
              providers,
              models: providers.flatMap((p) =>
                [...new Set([p.model, ...(models.get(p.id) || [])])].map((model) => ({
                  value: aiModelChoice(p.id, model),
                  label: model,
                  providerId: p.id,
                  protocol: p.protocol,
                  model,
                })),
              ),
            });
        };
        update();
        await Promise.all(
          providers.map(async (p) => {
            try {
              const list = await api<string[]>(
                '/terminal/ai/providers/' + encodeURIComponent(p.id) + '/models',
              );
              if (!current()) return;
              models.set(p.id, list);
              update();
            } catch {
              /* Retain the configured model for a provider without discovery. */
            }
          }),
        );
      } catch (error) {
        if (current()) onError(error);
      }
    },
    dispose() {
      disposed = true;
      serial++;
    },
  };
}
