import Architecture from './components/Architecture.jsx';
import Checks from './components/Checks.jsx';
import Compare from './components/Compare.jsx';
import Demo from './components/demo/Demo.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Hero from './components/Hero.jsx';
import Impact from './components/Impact.jsx';
import Nav from './components/Nav.jsx';
import Problem from './components/Problem.jsx';
import Solution from './components/Solution.jsx';
import Team from './components/Team.jsx';
import Traceability from './components/Traceability.jsx';

export default function App() {
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Nav />
      <main id="main">
        <Hero />
        <Problem />
        <Solution />
        <Architecture />
        <Traceability />
        <Checks />
        <ErrorBoundary title="The live demo crashed. Your documents were not uploaded anywhere.">
          <Demo />
        </ErrorBoundary>
        <Compare />
        <Impact />
        <Team />
      </main>
    </>
  );
}
