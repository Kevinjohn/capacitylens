import { test } from '@japa/runner';
import {
  buildCompanyExport,
  serializeCompanyExport,
} from '@capacitylens/shared/data/companyExport';
import { seed } from '@capacitylens/shared/data/seed';
import app from '@adonisjs/core/services/app';
import { CompanyImportService } from '#services/company_import_service';

const companyImports = await app.container.make(CompanyImportService);

// Expected invalid input becomes a 400; anything else must reach the exception handler and reporting.

test.group('expected input errors', () => {
  test('a request document parses, or is null only when it is invalid input', ({ assert }) => {
    // A request carries the file as the browser read it, in the export shape.
    const document = JSON.parse(
      serializeCompanyExport(
        buildCompanyExport(seed(), { companyId: 'a-studio', completeness: 'full' })
      )
    ) as { format: string };
    assert.equal(companyImports.parseRequestDocument(document)?.format, document.format);
    assert.isNull(companyImports.parseRequestDocument({ format: 'something else' }));
    assert.isNull(companyImports.parseRequestDocument(undefined));
    let nested: unknown[] = [];
    for (let depth = 0; depth < 200_000; depth += 1) nested = [nested];
    assert.isNull(companyImports.parseRequestDocument({ ...document, data: nested }));
  });

  test('an unexpected failure while reading a request document propagates', ({ assert }) => {
    const fault = new TypeError('unexpected reader fault');
    const document = {
      get format(): never {
        throw fault;
      },
    };
    assert.throws(() => companyImports.parseRequestDocument(document), 'unexpected reader fault');
  });
});
