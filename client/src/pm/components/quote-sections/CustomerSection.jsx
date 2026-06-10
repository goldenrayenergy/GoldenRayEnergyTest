import { Field, TextInput, Select, SectionGrid, SectionHeading } from './_shared';
import { REFERENCE } from '../../services/pmQuotesApi';

export default function CustomerSection({ spec, update, errors = {} }) {
  const c = spec.customer || {};
  const a = c.address || {};
  const setC = (key, val) => update(s => ({ ...s, customer: { ...s.customer, [key]: val } }));
  const setA = (key, val) => update(s => ({
    ...s,
    customer: { ...s.customer, address: { ...(s.customer?.address || {}), [key]: val } },
  }));

  return (
    <div>
      <SectionHeading
        title="Customer details"
        subtitle="Property owner and install address. Region picks regional yield (NIWA) and t_min for Voc cold check." />

      <SectionGrid columns={2}>
        <Field label="Full name" required error={errors['customer.full_name']}>
          <TextInput value={c.full_name} onChange={v => setC('full_name', v)} placeholder="Mr/Ms First Last" />
        </Field>
        <Field label="Email" required error={errors['customer.email']}>
          <TextInput type="email" value={c.email} onChange={v => setC('email', v)} placeholder="customer@example.com" />
        </Field>
        <Field label="Phone" error={errors['customer.phone']}>
          <TextInput value={c.phone} onChange={v => setC('phone', v)} placeholder="+64 21 ..." />
        </Field>
        <Field label="ICP number"
               hint="Electricity ICP from the bill — required for export application"
               error={errors['customer.icp_number']}>
          <TextInput value={c.icp_number} onChange={v => setC('icp_number', v)} placeholder="0000000000XXXXX" />
        </Field>
        <Field label="Property ownership">
          <Select value={c.property_ownership} onChange={v => setC('property_ownership', v)}
                  options={REFERENCE.propertyOwnership} />
        </Field>
      </SectionGrid>

      <h3 className="mt-6 mb-3 text-sm font-semibold text-slate-700 uppercase tracking-wide">Install address</h3>
      <SectionGrid columns={2}>
        <Field label="Street" required error={errors['customer.address.street']}>
          <TextInput value={a.street} onChange={v => setA('street', v)} placeholder="6 Woodacre Street" />
        </Field>
        <Field label="Suburb" required error={errors['customer.address.suburb']}>
          <TextInput value={a.suburb} onChange={v => setA('suburb', v)} placeholder="Flat Bush" />
        </Field>
        <Field label="City" required error={errors['customer.address.city']}>
          <TextInput value={a.city} onChange={v => setA('city', v)} placeholder="Auckland" />
        </Field>
        <Field label="Postcode">
          <TextInput value={a.postcode} onChange={v => setA('postcode', v)} placeholder="2019" />
        </Field>
        <Field label="Region" required
               hint="Drives regional yield + cold-temperature Voc safety check"
               error={errors['customer.address.region']}>
          <Select value={a.region} onChange={v => setA('region', v)} options={REFERENCE.regions} />
        </Field>
      </SectionGrid>
    </div>
  );
}
