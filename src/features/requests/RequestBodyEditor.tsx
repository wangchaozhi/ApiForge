import { translate as t, useLocale } from '../../i18n/index.ts';
import { CodeEditor } from '../../shared/components/CodeEditor.tsx';
import { KeyValueEditor } from '../../shared/components/KeyValueEditor.tsx';
import { MultipartEditor } from './MultipartEditor.tsx';
import type { ApiRequest, BodyType } from '../../domain/request.ts';

const bodyTypes: BodyType[] = ['none', 'json', 'raw', 'form-urlencoded', 'form-data'];

function bodyLabel(bodyType: BodyType) {
  if (bodyType === 'none') return t("None");
  if (bodyType === 'json') return 'JSON';
  if (bodyType === 'raw') return t("Raw");
  if (bodyType === 'form-urlencoded') return 'x-www-form-urlencoded';
  return 'form-data';
}

type Props = { request: ApiRequest; update: (updater: (request: ApiRequest) => ApiRequest) => void };

export function RequestBodyEditor({ request, update }: Props) {
  useLocale();
  return (
    <div className="body-editor">
      <div className="body-type-row">
        {bodyTypes.map((bodyType) => (
          <label key={bodyType}>
            <input
              type="radio"
              name="body-type"
              value={bodyType}
              checked={request.bodyType === bodyType}
              onChange={() => update((current) => ({ ...current, bodyType }))}
            />
            {bodyLabel(bodyType)}
          </label>
        ))}
      </div>
      {(request.bodyType === 'json' || request.bodyType === 'raw') && (
        <CodeEditor
          value={request.body}
          language={request.bodyType === 'json' ? 'json' : 'plaintext'}
          onChange={(body) => update((current) => ({ ...current, body }))}
        />
      )}
      {request.bodyType === 'form-urlencoded' && (
        <KeyValueEditor
          rows={request.formFields}
          onChange={(formFields) => update((current) => ({ ...current, formFields }))}
          keyPlaceholder={t("Key")}
          valuePlaceholder={t("Value")}
        />
      )}
      {request.bodyType === 'form-data' && (
        <MultipartEditor
          rows={request.multipartFields}
          onChange={(multipartFields) => update((current) => ({ ...current, multipartFields }))}
        />
      )}
    </div>
  );
}
