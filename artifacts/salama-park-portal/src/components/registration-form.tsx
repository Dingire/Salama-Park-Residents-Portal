import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Info } from 'lucide-react';
import { Link } from 'wouter';
import type { ResidentApplicationInput } from '@workspace/api-client-react';
import { SALAMA_PARK_STREETS, SALAMA_PARK_STREET_LIST_READY } from '../data/salama-park-streets';

/**
 * Street name list flag.
 *
 * A11 (street or zone) uses a dropdown backed by SALAMA_PARK_STREETS.
 * Add streets to src/data/salama-park-streets.ts as they become known.
 */
export { SALAMA_PARK_STREETS, SALAMA_PARK_STREET_LIST_READY, getSalamaParkStreets } from '../data/salama-park-streets';

const DECLARATIONS = [
  {
    key: 'declarationConfirmResident',
    text: 'I confirm that the residency information in this application is true and that I qualify in the membership category I have chosen.',
  },
  {
    key: 'declarationReadConstitution',
    text: 'I have read, or have been given the opportunity to read, the draft Constitution of the Salama Park Residents Association.',
  },
  {
    key: 'declarationMemberRegister',
    text: 'I consent to my details being entered in the register of members once my application is verified.',
  },
  {
    key: 'declarationVoterRoll',
    text: 'I consent to my details being used to compile the voter roll for online voting on the Constitution and the first elections.',
  },
  {
    key: 'declarationContactConsent',
    text: 'I consent to being contacted by phone, SMS or WhatsApp about association business.',
  },
  {
    key: 'declarationNoSubscription',
    text: 'I understand that no subscription is payable in order to register or to vote during the founding period.',
  },
  {
    key: 'declarationUndertakePayment',
    text: 'I undertake to pay the monthly subscription amount adopted by the members, if and when it becomes payable.',
  },
  {
    key: 'declarationUnderstandRelief',
    text: 'I understand that relief from the subscription may be available on grounds of hardship.',
  },
] as const;

const VOLUNTEER_SKILLS = [
  'Information technology',
  'Bookkeeping and finance',
  'Legal and governance',
  'Event organising',
  'Security',
  'Maintenance',
  'Other',
] as const;

type FormState = {
  // A — Personal identification
  fullName: string;
  nrcNumber: string;
  passportNumber: string;
  dateOfBirth: string;
  gender: '' | 'male' | 'female' | 'other';
  nationality: string;
  phone: string;
  phoneAlt: string;
  email: string;
  houseNumber: string;
  streetOrZone: string;
  plotNumber: string;
  // B — Residency
  livesInSalamaPark: 'yes' | 'no';
  residencyStatus:
    | ''
    | 'owner-occupier'
    | 'tenant'
    | 'owner-landlord'
    | 'family-member';
  residencySince: string;
  ownsProperty: 'yes' | 'no';
  propertyPlots: string;
  wardRegisteredVoter: '' | 'yes' | 'no';
  // C — Membership category
  membershipCategory: 'full' | 'associate' | 'honorary';
  otherAssociationMember: 'yes' | 'no';
  otherAssociationName: string;
  // D — Subscription poll
  subscriptionVote: '' | 'k50' | 'k100' | 'k150';
  agreeToPayAdopted: '' | 'yes' | 'no';
  reliefOption: '' | 'yes' | 'no' | 'not-applicable';
  paymentMethod: '' | 'mobile-money' | 'bank-transfer' | 'cash';
  // E — Declarations and signature
  signatureName: string;
  // G — Associate and honorary members
  principalResidenceAddress: string;
  associationBasis: string;
  nominatedBy: string;
  // H — Optional planning and skills
  occupation: string;
  willingToVolunteer: 'yes' | 'no';
  volunteerSkills: string[];
  volunteerSkillsOther: string;
  accessNeeds: string;
  preferredLanguage: '' | 'english' | 'nyanja' | 'bemba' | 'tonga' | 'other';
  adultsInHousehold: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  // Consent
  preferredNotification: 'email' | 'none';
  privacyNoticeAccepted: boolean;
};

const initialState: FormState = {
  fullName: '',
  nrcNumber: '',
  passportNumber: '',
  dateOfBirth: '',
  gender: '',
  nationality: 'Zambian',
  phone: '',
  phoneAlt: '',
  email: '',
  houseNumber: '',
  streetOrZone: '',
  plotNumber: '',
  livesInSalamaPark: 'yes',
  residencyStatus: '',
  residencySince: '',
  ownsProperty: 'yes',
  propertyPlots: '',
  wardRegisteredVoter: '',
  membershipCategory: 'full',
  otherAssociationMember: 'no',
  otherAssociationName: '',
  subscriptionVote: '',
  agreeToPayAdopted: '',
  reliefOption: '',
  paymentMethod: '',
  signatureName: '',
  principalResidenceAddress: '',
  associationBasis: '',
  nominatedBy: '',
  occupation: '',
  willingToVolunteer: 'no',
  volunteerSkills: [],
  volunteerSkillsOther: '',
  accessNeeds: '',
  preferredLanguage: '',
  adultsInHousehold: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',
  preferredNotification: 'none',
  privacyNoticeAccepted: false,
};

export function RegistrationForm({
  isPending,
  onSubmit,
}: {
  isPending: boolean;
  onSubmit: (data: ResidentApplicationInput) => void;
}) {
  const [form, setForm] = useState<FormState>(initialState);
  const [declarations, setDeclarations] = useState<
    Record<string, boolean>
  >(() =>
    Object.fromEntries(DECLARATIONS.map((item) => [item.key, false])),
  );
  const [localError, setLocalError] = useState('');

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const isNonResident = form.livesInSalamaPark === 'no';
  const isAssociateOrHonorary = form.membershipCategory !== 'full';
  const showSectionG = isNonResident || isAssociateOrHonorary;
  const allDeclarationsConfirmed = DECLARATIONS.every(
    (item) => declarations[item.key] === true,
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');

    if (!form.nrcNumber.trim() && !form.passportNumber.trim()) {
      setLocalError(
        'Enter your NRC number, or your passport number if you do not hold an NRC.',
      );
      return;
    }
    if (isNonResident && form.membershipCategory === 'full') {
      setLocalError(
        'Full membership requires current residence in Salama Park. Choose associate membership if you are a non-resident property owner.',
      );
      return;
    }
    if (!form.subscriptionVote) {
      setLocalError('Choose one subscription amount in Section D.');
      return;
    }
    if (!form.agreeToPayAdopted || !form.reliefOption) {
      setLocalError('Answer the subscription questions in Section D.');
      return;
    }
    if (!allDeclarationsConfirmed) {
      setLocalError('Confirm every declaration in Section E.');
      return;
    }
    if (!form.signatureName.trim()) {
      setLocalError('Type your full name as your digital signature.');
      return;
    }
    if (isNonResident && !form.principalResidenceAddress.trim()) {
      setLocalError('Provide the address of your principal residence.');
      return;
    }
    if (isAssociateOrHonorary && !form.associationBasis.trim()) {
      setLocalError(
        'Describe the basis of your association with Salama Park (Section G).',
      );
      return;
    }
    if (form.membershipCategory === 'honorary' && !form.nominatedBy.trim()) {
      setLocalError('Provide the member or body that nominated you (Section G).');
      return;
    }
    if (form.otherAssociationMember === 'yes' && !form.otherAssociationName.trim()) {
      setLocalError('Name the other residents association you belong to.');
      return;
    }
    const emergencyFields = [
      form.emergencyContactName.trim(),
      form.emergencyContactPhone.trim(),
      form.emergencyContactRelationship.trim(),
    ];
    if (emergencyFields.some(Boolean) && !emergencyFields.every(Boolean)) {
      setLocalError(
        'Complete the emergency contact name, phone number and relationship, or leave all three blank.',
      );
      return;
    }
    if (!form.privacyNoticeAccepted) {
      setLocalError('Please acknowledge the privacy notice before submitting.');
      return;
    }

    const adults = form.adultsInHousehold.trim()
      ? Math.max(
          1,
          Math.min(30, Math.round(Number(form.adultsInHousehold) || 1)),
        )
      : null;
    const skills = [
      ...form.volunteerSkills.filter((skill) => skill !== 'Other'),
      form.volunteerSkills.includes('Other')
        ? `Other: ${form.volunteerSkillsOther.trim() || 'not specified'}`
        : null,
    ]
      .filter(Boolean)
      .join(', ');

    onSubmit({
      fullName: form.fullName.trim(),
      nrcNumber: form.nrcNumber.trim() || null,
      passportNumber: form.passportNumber.trim() || null,
      dateOfBirth: form.dateOfBirth,
      gender: form.gender as 'male' | 'female' | 'other',
      nationality: form.nationality.trim(),
      phone: form.phone.trim(),
      phoneAlt: form.phoneAlt.trim() || null,
      email: form.email.trim() || null,
      houseNumber: form.houseNumber.trim(),
      streetOrZone: form.streetOrZone.trim(),
      plotNumber: form.plotNumber.trim() || null,
      livesInSalamaPark: form.livesInSalamaPark === 'yes',
      residencyStatus: form.residencyStatus as
        | 'owner-occupier'
        | 'tenant'
        | 'owner-landlord'
        | 'family-member',
      residencySince: form.residencySince,
      ownsProperty: form.ownsProperty === 'yes',
      propertyPlots: form.propertyPlots.trim() || null,
      wardRegisteredVoter:
        form.wardRegisteredVoter === ''
          ? null
          : form.wardRegisteredVoter === 'yes',
      membershipCategory: form.membershipCategory,
      otherAssociationMember: form.otherAssociationMember === 'yes',
      otherAssociationName:
        form.otherAssociationMember === 'yes'
          ? form.otherAssociationName.trim()
          : null,
      subscriptionVote: form.subscriptionVote as 'k50' | 'k100' | 'k150',
      agreeToPayAdopted: form.agreeToPayAdopted === 'yes',
      reliefOption: form.reliefOption as 'yes' | 'no' | 'not-applicable',
      paymentMethod:
        (form.paymentMethod as 'mobile-money' | 'bank-transfer' | 'cash') ||
        null,
      declarationConfirmResident: declarations.declarationConfirmResident,
      declarationReadConstitution: declarations.declarationReadConstitution,
      declarationMemberRegister: declarations.declarationMemberRegister,
      declarationVoterRoll: declarations.declarationVoterRoll,
      declarationContactConsent: declarations.declarationContactConsent,
      declarationNoSubscription: declarations.declarationNoSubscription,
      declarationUndertakePayment: declarations.declarationUndertakePayment,
      declarationUnderstandRelief: declarations.declarationUnderstandRelief,
      signatureName: form.signatureName.trim(),
      principalResidenceAddress:
        form.principalResidenceAddress.trim() || null,
      associationBasis: form.associationBasis.trim() || null,
      nominatedBy: form.nominatedBy.trim() || null,
      occupation: form.occupation.trim() || null,
      willingToVolunteer: form.willingToVolunteer === 'yes',
      volunteerSkills: skills || null,
      accessNeeds: form.accessNeeds.trim() || null,
      preferredLanguage:
        (form.preferredLanguage as
          | 'english'
          | 'nyanja'
          | 'bemba'
          | 'tonga'
          | 'other') || null,
      adultsInHousehold: adults,
      emergencyContactName: form.emergencyContactName.trim() || null,
      emergencyContactPhone: form.emergencyContactPhone.trim() || null,
      emergencyContactRelationship:
        form.emergencyContactRelationship.trim() || null,
      preferredNotification: form.preferredNotification,
      privacyNoticeAccepted: form.privacyNoticeAccepted,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Section
        title="Section A · Personal identification"
        description="Your identity details are reviewed privately by association officials and are never published."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Full name"
            required
            value={form.fullName}
            onChange={(v) => update('fullName', v)}
          />
          <TextField
            label="Nationality"
            required
            value={form.nationality}
            onChange={(v) => update('nationality', v)}
          />
          <TextField
            label="NRC number"
            value={form.nrcNumber}
            onChange={(v) => update('nrcNumber', v)}
            hint="Required unless you provide a passport number."
            placeholder="e.g. 123456/78/9"
          />
          <TextField
            label="Passport number"
            value={form.passportNumber}
            onChange={(v) => update('passportNumber', v)}
            hint="If you do not hold a Zambian NRC."
          />
          <TextField
            label="Date of birth"
            required
            type="date"
            value={form.dateOfBirth}
            onChange={(v) => update('dateOfBirth', v)}
          />
          <SelectField
            label="Gender"
            required
            value={form.gender}
            onChange={(v) => update('gender', v as FormState['gender'])}
            options={[
              ['', 'Select…'],
              ['male', 'Male'],
              ['female', 'Female'],
              ['other', 'Other'],
            ]}
          />
          <TextField
            label="Phone number"
            required
            type="tel"
            value={form.phone}
            onChange={(v) => update('phone', v)}
          />
          <TextField
            label="Alternative phone number"
            type="tel"
            value={form.phoneAlt}
            onChange={(v) => update('phoneAlt', v)}
          />
          <TextField
            label="Email address"
            type="email"
            value={form.email}
            onChange={(v) => update('email', v)}
          />
          <TextField
            label="House number"
            required
            value={form.houseNumber}
            onChange={(v) => update('houseNumber', v)}
          />
          {SALAMA_PARK_STREET_LIST_READY ? (
            <SelectField
              label="Street or zone"
              required
              value={form.streetOrZone}
              onChange={(v) => update('streetOrZone', v)}
              options={[
                ['', 'Select…'],
                ...SALAMA_PARK_STREETS.map((street) => [street, street] as const),
              ]}
            />
          ) : (
            <TextField
              label="Street or zone"
              required
              value={form.streetOrZone}
              onChange={(v) => update('streetOrZone', v)}
              hint="Street name list to be supplied by the association. Enter your street or zone manually for now."
              list="salama-park-streets"
            />
          )}
          <TextField
            label="Plot number"
            value={form.plotNumber}
            onChange={(v) => update('plotNumber', v)}
          />
        </div>
        <datalist id="salama-park-streets">
          {SALAMA_PARK_STREETS.map((street) => (
            <option key={street} value={street} />
          ))}
        </datalist>
      </Section>

      <Section
        title="Section B · Residency"
        description="These answers establish your eligibility for the membership category you choose."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <RadioField
            label="Do you currently live in Salama Park?"
            required
            name="livesInSalamaPark"
            value={form.livesInSalamaPark}
            onChange={(v) =>
              update('livesInSalamaPark', v as 'yes' | 'no')
            }
            options={[
              ['yes', 'Yes'],
              ['no', 'No'],
            ]}
          />
          <RadioField
            label="Do you own the property?"
            required
            name="ownsProperty"
            value={form.ownsProperty}
            onChange={(v) => update('ownsProperty', v as 'yes' | 'no')}
            options={[
              ['yes', 'Yes'],
              ['no', 'No'],
            ]}
          />
          <SelectField
            label="Residency status"
            required
            value={form.residencyStatus}
            onChange={(v) =>
              update('residencyStatus', v as FormState['residencyStatus'])
            }
            options={[
              ['', 'Select…'],
              ['owner-occupier', 'Owner-occupier'],
              ['tenant', 'Tenant'],
              ['owner-landlord', 'Owner / landlord'],
              ['family-member', 'Family member'],
            ]}
          />
          <TextField
            label="Resident in Salama Park since"
            required
            type="month"
            value={form.residencySince}
            onChange={(v) => update('residencySince', v)}
            hint="Month and year are acceptable."
          />
          <TextField
            label="Plot numbers of property owned"
            value={form.propertyPlots}
            onChange={(v) => update('propertyPlots', v)}
            hint="Leave blank if you do not own property here."
          />
          <RadioField
            label="Are you registered to vote in this ward?"
            name="wardRegisteredVoter"
            value={form.wardRegisteredVoter}
            onChange={(v) =>
              update('wardRegisteredVoter', v as FormState['wardRegisteredVoter'])
            }
            options={[
              ['yes', 'Yes'],
              ['no', 'No'],
            ]}
          />
        </div>
      </Section>

      <Section
        title="Section C · Membership category"
        description="Choose one category. Associate and honorary applications require the additional details in Section G."
      >
        <fieldset>
          <legend className="text-sm font-medium text-[#35485c]">
            Membership category <span className="text-[#9a4a43]">*</span>
          </legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {(
              [
                ['full', 'Full member', 'A resident of Salama Park.'],
                [
                  'associate',
                  'Associate member',
                  'A non-resident property owner or former resident.',
                ],
                [
                  'honorary',
                  'Honorary member',
                  'Invited by the association in recognition of service.',
                ],
              ] as const
            ).map(([value, label, text]) => (
              <label
                key={value}
                className={`flex cursor-pointer flex-col rounded-xl border-2 p-4 transition-colors ${
                  form.membershipCategory === value
                    ? 'border-[#315f43] bg-[#eef6ee]'
                    : 'border-[#e1dfd8] bg-white hover:border-[#b8c9b7]'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-[#1b2e45]">
                  <input
                    type="radio"
                    name="membershipCategory"
                    className="accent-[#315f43]"
                    checked={form.membershipCategory === value}
                    onChange={() => update('membershipCategory', value)}
                  />
                  {label}
                </span>
                <span className="mt-2 text-xs leading-5 text-[#687486]">
                  {text}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <RadioField
            label="Are you a member of any other residents association?"
            required
            name="otherAssociationMember"
            value={form.otherAssociationMember}
            onChange={(v) =>
              update('otherAssociationMember', v as 'yes' | 'no')
            }
            options={[
              ['yes', 'Yes'],
              ['no', 'No'],
            ]}
          />
          {form.otherAssociationMember === 'yes' && (
            <TextField
              label="Name of the other association"
              required
              value={form.otherAssociationName}
              onChange={(v) => update('otherAssociationName', v)}
            />
          )}
        </div>
      </Section>

      <Section
        title="Section D · Subscription poll"
        description="Choose the monthly subscription you are willing to commit to. Only one amount may be selected; the poll counts one vote per application."
      >
        <fieldset>
          <legend className="text-sm font-medium text-[#35485c]">
            Monthly subscription <span className="text-[#9a4a43]">*</span>
          </legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {(
              [
                ['k50', 'K50.00'],
                ['k100', 'K100.00'],
                ['k150', 'K150.00'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center justify-center rounded-xl border-2 px-4 py-5 text-center transition-colors ${
                  form.subscriptionVote === value
                    ? 'border-[#315f43] bg-[#eef6ee]'
                    : 'border-[#e1dfd8] bg-white hover:border-[#b8c9b7]'
                }`}
              >
                <input
                  type="radio"
                  name="subscriptionVote"
                  className="sr-only"
                  checked={form.subscriptionVote === value}
                  onChange={() => update('subscriptionVote', value)}
                />
                <span className="font-semibold text-[#1b2e45]">
                  {label}
                  <span className="block text-xs font-normal text-[#87918e]">
                    per month
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <RadioField
            label="Do you agree to pay the subscription amount adopted by the members?"
            required
            name="agreeToPayAdopted"
            value={form.agreeToPayAdopted}
            onChange={(v) =>
              update('agreeToPayAdopted', v as FormState['agreeToPayAdopted'])
            }
            options={[
              ['yes', 'Yes'],
              ['no', 'No'],
            ]}
          />
          <RadioField
            label="If you are unable to pay, will you apply for relief on grounds of hardship?"
            required
            name="reliefOption"
            value={form.reliefOption}
            onChange={(v) =>
              update('reliefOption', v as FormState['reliefOption'])
            }
            options={[
              ['yes', 'Yes'],
              ['no', 'No'],
              ['not-applicable', 'Not applicable'],
            ]}
          />
          <SelectField
            label="Preferred payment method"
            value={form.paymentMethod}
            onChange={(v) =>
              update('paymentMethod', v as FormState['paymentMethod'])
            }
            options={[
              ['', 'No preference'],
              ['mobile-money', 'Mobile money'],
              ['bank-transfer', 'Bank transfer'],
              ['cash', 'Cash'],
            ]}
          />
        </div>
      </Section>

      <Section
        title="Section E · Declaration and consent"
        description="Every declaration must be confirmed. The date of signature is recorded automatically when you submit."
      >
        <div className="space-y-3">
          {DECLARATIONS.map((item) => (
            <label
              key={item.key}
              className="flex items-start gap-3 text-sm leading-6 text-[#536174]"
            >
              <input
                type="checkbox"
                className="mt-1 accent-[#315f43]"
                checked={declarations[item.key] === true}
                onChange={(event) =>
                  setDeclarations((current) => ({
                    ...current,
                    [item.key]: event.target.checked,
                  }))
                }
              />
              {item.text}
            </label>
          ))}
        </div>
        <div className="mt-5 max-w-md">
          <TextField
            label="Digital signature (type your full name)"
            required
            value={form.signatureName}
            onChange={(v) => update('signatureName', v)}
            hint="Typing your name records your signature against this application."
          />
        </div>
      </Section>

      {showSectionG && (
        <Section
          title="Section G · Associate and honorary details"
          description="This section applies because you are a non-resident, an associate member, or an honorary member."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Address of your principal residence"
              required={isNonResident}
              value={form.principalResidenceAddress}
              onChange={(v) => update('principalResidenceAddress', v)}
              hint="Required if you do not live in Salama Park."
            />
            <TextField
              label="Basis of your association with Salama Park"
              required={isAssociateOrHonorary}
              value={form.associationBasis}
              onChange={(v) => update('associationBasis', v)}
              hint="e.g. property owner, former resident, invited honorary member."
            />
            <TextField
              label="Nominated by"
              required={form.membershipCategory === 'honorary'}
              value={form.nominatedBy}
              onChange={(v) => update('nominatedBy', v)}
              hint="Required for honorary members: the member or body that nominated you."
            />
          </div>
        </Section>
      )}

      <Section
        title="Section H · Optional planning and skills"
        description="These answers help the association plan services. They are optional and are never used to exclude anyone from membership."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Occupation or profession"
            value={form.occupation}
            onChange={(v) => update('occupation', v)}
          />
          <SelectField
            label="Preferred language for association communication"
            value={form.preferredLanguage}
            onChange={(v) =>
              update('preferredLanguage', v as FormState['preferredLanguage'])
            }
            options={[
              ['', 'No preference'],
              ['english', 'English'],
              ['nyanja', 'Nyanja'],
              ['bemba', 'Bemba'],
              ['tonga', 'Tonga'],
              ['other', 'Other'],
            ]}
          />
          <RadioField
            label="Are you willing to volunteer your time?"
            name="willingToVolunteer"
            value={form.willingToVolunteer}
            onChange={(v) =>
              update('willingToVolunteer', v as 'yes' | 'no')
            }
            options={[
              ['yes', 'Yes'],
              ['no', 'No'],
            ]}
          />
          <TextField
            label="Number of adults in your household"
            type="number"
            min={1}
            max={30}
            value={form.adultsInHousehold}
            onChange={(v) => update('adultsInHousehold', v)}
            hint="Optional; used only for planning totals."
          />
        </div>
        {form.willingToVolunteer === 'yes' && (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-[#35485c]">
              Skills or areas you can help with
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {VOLUNTEER_SKILLS.map((skill) => (
                <label
                  key={skill}
                  className="flex items-center gap-2 text-sm text-[#536174]"
                >
                  <input
                    type="checkbox"
                    className="accent-[#315f43]"
                    checked={form.volunteerSkills.includes(skill)}
                    onChange={(event) =>
                      update(
                        'volunteerSkills',
                        event.target.checked
                          ? [...form.volunteerSkills, skill]
                          : form.volunteerSkills.filter(
                              (item) => item !== skill,
                            ),
                      )
                    }
                  />
                  {skill}
                </label>
              ))}
            </div>
            {form.volunteerSkills.includes('Other') && (
              <div className="mt-3 max-w-md">
                <TextField
                  label="Other skill"
                  value={form.volunteerSkillsOther}
                  onChange={(v) => update('volunteerSkillsOther', v)}
                />
              </div>
            )}
          </fieldset>
        )}
        <div className="mt-4">
          <label className="block text-sm font-medium text-[#35485c]">
            Disability or access needs
            <span className="ml-1 font-normal text-[#87918e]">(optional)</span>
            <textarea
              value={form.accessNeeds}
              onChange={(event) => update('accessNeeds', event.target.value)}
              rows={2}
              maxLength={500}
              className="field mt-1.5"
              placeholder="Anything the association should know to include you fully."
            />
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <TextField
            label="Emergency contact name"
            value={form.emergencyContactName}
            onChange={(v) => update('emergencyContactName', v)}
          />
          <TextField
            label="Emergency contact phone"
            type="tel"
            value={form.emergencyContactPhone}
            onChange={(v) => update('emergencyContactPhone', v)}
          />
          <TextField
            label="Emergency contact relationship"
            value={form.emergencyContactRelationship}
            onChange={(v) => update('emergencyContactRelationship', v)}
            placeholder="e.g. spouse, parent, neighbour"
          />
        </div>
      </Section>

      <Section title="Consent">
        <div className="grid gap-4 sm:max-w-md">
          <SelectField
            label="Preferred contact for updates"
            value={form.preferredNotification}
            onChange={(v) =>
              update('preferredNotification', v as FormState['preferredNotification'])
            }
            options={[
              ['email', 'Email'],
              ['none', 'No notifications for now'],
            ]}
            hint="SMS delivery is not connected yet."
          />
        </div>
        <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-[#536174]">
          <input
            type="checkbox"
            className="mt-1 accent-[#315f43]"
            checked={form.privacyNoticeAccepted}
            onChange={(event) =>
              update('privacyNoticeAccepted', event.target.checked)
            }
          />
          I have read and accept the{' '}
          <Link href="/privacy" className="text-[#315f43] underline">
            privacy notice
          </Link>
          .
        </label>
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#dce3dd] bg-[#f1f5f0] p-4 text-xs leading-5 text-[#405a49]">
          <Info size={16} className="mt-0.5 shrink-0" />
          Submitting an application is not automatic membership. An association
          official verifies every application against Sections F of the
          association's registration record.
        </div>
      </Section>

      {localError && (
        <div className="rounded-xl border border-[#e8caca] bg-[#fcf1ef] px-4 py-3 text-sm leading-6 text-[#8a3737]">
          {localError}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="btn-primary disabled:cursor-not-allowed disabled:opacity-55"
      >
        {isPending ? 'Submitting…' : 'Submit application'}
        {isPending ? null : <ArrowRight size={15} />}
      </button>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#e1dfd8] bg-white p-6">
      <h2 className="font-semibold text-[#1b2e45]">{title}</h2>
      {description && (
        <p className="mt-2 text-sm leading-6 text-[#657184]">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TextField({
  label,
  required,
  type = 'text',
  value,
  onChange,
  hint,
  placeholder,
  min,
  max,
  list,
}: {
  label: string;
  required?: boolean;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  list?: string;
}) {
  return (
    <label className="block text-sm font-medium text-[#35485c]">
      {label}
      {required ? <span className="text-[#9a4a43]"> *</span> : null}
      <input
        type={type}
        required={required}
        value={value}
        min={min}
        max={max}
        list={list}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="field mt-1.5"
      />
      {hint && (
        <span className="mt-1 block text-xs font-normal leading-5 text-[#87918e]">
          {hint}
        </span>
      )}
    </label>
  );
}

function SelectField({
  label,
  required,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
  hint?: string;
}) {
  return (
    <label className="block text-sm font-medium text-[#35485c]">
      {label}
      {required ? <span className="text-[#9a4a43]"> *</span> : null}
      <select
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field mt-1.5"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
      {hint && (
        <span className="mt-1 block text-xs font-normal leading-5 text-[#87918e]">
          {hint}
        </span>
      )}
    </label>
  );
}

function RadioField({
  label,
  required,
  name,
  value,
  onChange,
  options,
}: {
  label: string;
  required?: boolean;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-[#35485c]">
        {label}
        {required ? <span className="text-[#9a4a43]"> *</span> : null}
      </legend>
      <div className="mt-2 flex flex-wrap gap-4">
        {options.map(([optionValue, optionLabel]) => (
          <label
            key={optionValue}
            className="flex items-center gap-2 text-sm text-[#536174]"
          >
            <input
              type="radio"
              name={name}
              value={optionValue}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
              className="accent-[#315f43]"
            />
            {optionLabel}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
