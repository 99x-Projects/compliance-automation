// Schemas and control catalogues, imported statically so the publisher bundle embeds them.
// validate-contracts checks that this list matches the files on disk.
import common from '../../contracts/schemas/compliance-common.v1.schema.json' with { type: 'json' };
import report from '../../contracts/schemas/compliance-report.v1.schema.json' with { type: 'json' };
import event from '../../contracts/schemas/compliance-event.v1.schema.json' with { type: 'json' };
import catalog from '../../contracts/schemas/control-catalog.v1.schema.json' with { type: 'json' };
import iso9001 from '../../contracts/catalogs/iso-9001-2015.json' with { type: 'json' };
import iso27001Sample from '../../contracts/catalogs/iso-27001-2022.sample.json' with { type: 'json' };

export const SCHEMAS = {
  'compliance-common.v1.schema.json': common,
  'compliance-report.v1.schema.json': report,
  'compliance-event.v1.schema.json': event,
  'control-catalog.v1.schema.json': catalog,
};

export const CATALOGS = {
  'iso-9001-2015.json': iso9001,
  'iso-27001-2022.sample.json': iso27001Sample,
};

// Catalogues the publisher accepts in production. Sample catalogues are for tests only.
export const PRODUCTION_CATALOGS = Object.values(CATALOGS).filter((c) => c.coverage !== 'sample');
