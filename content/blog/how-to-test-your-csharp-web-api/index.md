---
title: How to test your C# Web API
slug: how-to-test-your-csharp-web-api
description: How to use functional testing to have confidence in the code you ship.
author: Tim Deschryver
date: 2020-03-23
tags: csharp, dotnet, testing, xunit
banner: ./images/banner.jpg
bannerCredit: Photo by [Kinga Cichewicz](https://unsplash.com/@all_who_wander) on [Unsplash](https://unsplash.com)
published: true
---

If you've read some of my other blog posts, you probably know that I'm not a big fan of unit tests.
Sure, they have their purposes, but often it means that one or more parts of the System Under Test (SUT) are being mocked or stubbed. It's this practice that I'm not too keen about.

To have full confidence in my code, it are integration tests that I will be grabbing for.
In my experience, integration tests [are also easier and faster to write](/blog/why-writing-integration-tests-on-a-csharp-api-is-a-productivity-booster).

With an integration test, we test the API from the outside out by spinning up the (in-memory) API client and making an actual HTTP request. I get confidence out of it because I mock as little as possible, and I will consume my API in the same way as an application (or user) would.

> The following tests are written in .NET 5 (but this also applies to .NET Core 3) and are using [XUnit](https://xunit.net/) as test the runner.
> The setup might change with other versions and test runners but the idea remains the same.

## A simple test

The only requirement is that the `Microsoft.AspNetCore.Mvc.Testing` package is installed, you can do this with the following command.

```bash
dotnet add package Microsoft.AspNetCore.Mvc.Testing
```

> TIP: I also use `FluentAssertions` to write my assertions because the package contains some useful utility methods, and it's easy to read.

The `Microsoft.AspNetCore.Mvc.Testing` packages includes a `WebApplicationFactory<TEntryPoint>` class which is used to create the API in memory. This is convenient, as we don't need to have the API running before we run these integration tests.

In the test class, we inject the factory into the constructor.
With the factory, we can create a `HttpClient` which is used in the tests to make HTTP requests.

```cs
public class WeatherForecastControllerTests: IClassFixture<WebApplicationFactory<Api.Startup>>
{
    readonly HttpClient _client;

    public WeatherForecastControllerTests(WebApplicationFactory<Api.Startup> fixture)
    {
        _client = fixture.CreateClient();
    }
}
```

Because the test class implements from XUnit's `IClassFixture` interface, the tests inside this class will share a single test context. The API will only be bootstrapped once for all the tests and will be cleanup afterward.

This is everything we need to write the first test.
Using the `HttpClient` we can make a GET request and assert the response the API gives back.

```cs{10-18}
public class WeatherForecastControllerTests: IClassFixture<WebApplicationFactory<Api.Startup>>
{
    readonly HttpClient _client;

    public WeatherForecastControllerTests(WebApplicationFactory<Api.Startup> fixture)
    {
        _client = fixture.CreateClient();
    }

    [Fact]
    public async Task GET_retrieves_weather_forecast()
    {
        var response = await _client.GetAsync("/weatherforecast");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var forecast = JsonConvert.DeserializeObject<WeatherForecast[]>(await response.Content.ReadAsStringAsync());
        forecast.Should().HaveCount(5);
    }
}
```

How neat is this!
To write a test that provides real value, we (almost) have no setup!

## Writing your own `WebApplicationFactory`

Sadly, in a real application, things get more complicated.
There are external dependencies, and these might need to be mocked or stubbed.

I suggest keeping the real instances of dependencies that you're in control of, for example, the database.
For dependencies that are out of your reach, mostly 3rd-party driven ports, we need a stubbed/mocked instance.
This allows you to return expected data and prevents that test data is created in a 3rd party service.

> [Jimmy Bogard](https://twitter.com/jbogard) explains why you should avoid in-memory databases for your tests in his recent blog post ["Avoid In-Memory Databases for Tests"](https://jimmybogard.com/avoid-in-memory-databases-for-tests/)

Luckily, it's simple to change the configuration of the API and to substitute the real interface instances.
By creating a custom `WebApplicationFactory`, the configuration can be altered before the API is built.
To do this, override the `ConfigureWebHost` method.

```cs
public class ApiWebApplicationFactory : WebApplicationFactory<Api.Startup>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // will be called after the `ConfigureServices` from the Startup
        builder.ConfigureTestServices(services =>
        {
            services.AddTransient<IWeatherForecastConfigService, WeatherForecastConfigStub>();
        });
    }
}

public class WeatherForecastConfigStub : IWeatherForecastConfigService
{
    public int NumberOfDays() => 7;
}
```

To work with a real database I find it easier to create a separate database to run these tests.
Therefore, it's needed to create a new settings file to provide some environment variables that are used in the tests.

In this example, the settings file contains the new connectionstring pointing towards to the integration test database instance.

To configure the application, we use the `ConfigureAppConfiguration` method to add our test configuration settings.

```cs{7-14}
public class ApiWebApplicationFactory : WebApplicationFactory<Api.Startup>
{
    public IConfiguration Configuration { get; private set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration(config =>
        {
            Configuration = new ConfigurationBuilder()
                .AddJsonFile("integrationsettings.json")
                .Build();

            config.AddConfiguration(Configuration);
        });

        builder.ConfigureTestServices(services =>
        {
            services.AddTransient<IWeatherForecastConfigService, WeatherForecastConfigStub>();
        });
    }
}
```

```json:integrationsettings.json
{
  "ConnectionStrings": {
    "SQL": "Data Source=tcp:localhost,1533;Initial Catalog=IntegrationDB;User Id=sa;Password=password;MultipleActiveResultSets=True"
  }
}
```

## A custom and reusable fixture

What I like to do is making each test independent from the other.
This has as benefit that tests won't interfere with each other, and that each test can be written/debugged on its own.
To be able to do this, we have to perform a reseed of the database before each test runs.

> To reseed my databases I'm using the [Respawn](https://github.com/jbogard/Respawn) package

To keep things DRY and to hide some of this logic, one of the possibilities is to create an abstraction layer.
With an abstract class, `IntegrationTest`, it's possible to expose commonly used variables, the most important one being the `HttpClient` because we need it to create the HTTP requests.

```cs
public abstract class IntegrationTest : IClassFixture<ApiWebApplicationFactory>
{
    private readonly Checkpoint _checkpoint = new Checkpoint
    {
        SchemasToInclude = new[] {
            "Playground"
        },
        WithReseed = true
    };

    protected readonly ApiWebApplicationFactory _factory;
    protected readonly HttpClient _client;

    public IntegrationTest(ApiWebApplicationFactory fixture)
    {
        _factory = fixture;
        _client = _factory.CreateClient();

        _checkpoint.Reset(_factory.Configuration.GetConnectionString("SQL")).Wait();
    }
}
```

The test class can now inherit from the `IntegrationTest` fixture and looks as follows.

```cs
public class WeatherForecastControllerTests: Fixtures.IntegrationTest
{
    public WeatherForecastControllerTests(ApiWebApplicationFactory fixture)
      : base(fixture) {}

    [Fact]
    public async Task GET_retrieves_weather_forecast()
    {
        var response = await _client.GetAsync("/weatherforecast");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var forecast = JsonConvert.DeserializeObject<WeatherForecast[]>(
          await response.Content.ReadAsStringAsync()
        );
        forecast.Should().HaveCount(7);
    }
}
```

As you can see in the code above, the test class doesn't contain setup logic because of the `IntegrationTest` abstraction.

## WithWebHostBuilder

To prevent an exponential growth of test fixtures, we can use the `WithWebHostBuilder` method on `WebApplicationFactory`. This is helpful for tests that require a different, specific setup.

The `WithWebHostBuilder` method will create a new instance of the `WebApplicationFactory`.
If a custom `WebApplicationFactory` class is used (in this example, `ApiWebApplicationFactory`) the logic inside `ConfigureWebHost` will still be executed.

In the code below we use the `InvalidWeatherForecastConfigStub` class to fake an invalid configuration, which should result in a bad request. Because this setup is only required once, we can set it up inside the test itself.

```cs{4-11}
[Fact]
public async Task GET_with_invalid_config_results_in_a_bad_request()
{
    var client = _factory.WithWebHostBuilder(builder =>
    {
        builder.ConfigureServices(services =>
        {
            services.AddTransient<IWeatherForecastConfigService, InvalidWeatherForecastConfigStub>();
        });
    })
    .CreateClient(new WebApplicationFactoryClientOptions());

    var response = await client.GetAsync("/weatherforecast");
    response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
}
```

## Useful utilities

### Testing basic endpoints at once

For tests that require an identical setup, we can write a `Theory` with `InlineData` to test multiple endpoints at once.
This tip only applies to simple requests and is a quick way to verify that these endpoints don't throw an error.

```cs
[Theory]
[InlineData("/endoint1")]
[InlineData("/endoint2/details")]
[InlineData("/endoint3?amount=10&page=1")]
public async Task Smoketest_endpoint_with_different_params_are_OK(string endpoint)
{
    var response = await _client.GetAsync(endpoint);
    response.StatusCode.Should().Be(HttpStatusCode.OK);
}
```

### Keep tests short and readable

Making API requests and deserializing the response of the request adds a lot of boilerplate and duplication to your tests. To make a test concise, we can extract this logic and refactor it into an extension method.

```cs
public static class Extensions
{
    public static Task<T> GetAndDeserialize<T>(this HttpClient client, string requestUri)
    {
        var response = await _client.GetAsync(requestUri);
        response.EnsureSuccessStatusCode();
        var result = await response.Content.ReadAsStringAsync();
        return JsonConvert.DeserializeObject<T>(result);

        // Note: this can be turned into a one-liner with .NET 5, or with the System.Net.Http.Json package
        // return client.GetFromJsonAsync<T>(requestUri);
    }
}
```

Within a blink of an eye, we can now understand the refactored test.

```cs
public class WeatherForecastControllerTests: Fixtures.IntegrationTest
{
    public WeatherForecastControllerTests(ApiWebApplicationFactory fixture)
      : base(fixture) {}

    [Fact]
    public async Task GET_retrieves_weather_forecast()
    {
        var forecast = await _client.GetAndDeserialize("/weatherforecast");
        forecast.Should().HaveCount(7);
    }
}
```

### Testing authenticated endpoints

For testing endpoints where you have to be authenticated, we have some options.

#### AllowAnonymousFilter

The most simple one is to just allow anonymous requests, this can be done by adding the `AllowAnonymousFilter`.

```cs
builder.ConfigureTestServices(services =>
{
    MvcServiceCollectionExtensions.AddMvc(services, options => options.Filters.Add(new AllowAnonymousFilter()));
});
```

#### AuthenticationHandler

The second option is to create a custom authentication handler.

> In a [GitHub issue](https://github.com/dotnet/AspNetCore.Docs/issues/6882) you can find multiple solutions to implement this.

The authentication handler will create a claim to represent an authenticated user.

```cs
public class IntegrationTestAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public IntegrationTestAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options,
      ILoggerFactory logger, UrlEncoder encoder, ISystemClock clock)
      : base(options, logger, encoder, clock)
    {
    }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[] {
            new Claim(ClaimTypes.Name, "IntegrationTest User"),
            new Claim(ClaimTypes.NameIdentifier, "IntegrationTest User"),
        };
        var identity = new ClaimsIdentity(claims, "IntegrationTest");
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, "IntegrationTest");
        var result = AuthenticateResult.Success(ticket);
        return Task.FromResult(result);
    }
}
```

We must configure the application by adding the authentication handler.
To create an authenticated request we must add the `Authorization` header to the request.

```cs
builder.ConfigureTestServices(services =>
{
    services.AddAuthentication("IntegrationTest")
        .AddScheme<AuthenticationSchemeOptions, IntegrationTestAuthenticationHandler>(
          "IntegrationTest",
          options => { }
        );
});

...

_client = _factory.CreateClient();
_client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("IntegrationTest");
```

#### Using a real token

The last option is to use a real token.
This also means that you will have to generate a token before the tests run.
Once the token is generated it can be stored to not having to generate a token for each test, which will slow down the execution of the tests. Plus, we're not testing the authentication in these integration tests.

Just like before, we must add the token to the request header, but we're also assigning the token to the header.

```cs
_client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", GetToken());

public static string GetToken()
{
    if (accessToken != null)
    {
        return accessToken;
    }

    // actual logic of generating a token
    return accessToken;
}
```

#### Parallel tests

If multiple tests try to read and write to the same database, this may lead to deadlocks.
That's why we had to turn off the parallelization of our tests.
For XUnit, this is done by setting the `parallelizeTestCollections` property to `false` inside the `xunit.runner.json` config file.
Read more about this in the [XUnit docs](https://xunit.net/docs/configuration-files#parallelizeTestCollections).

```json
{
	"$schema": "https://xunit.net/schema/current/xunit.runner.schema.json",
	"parallelizeTestCollections": false
}
```

## Conclusion

Previously I didn't like to write tests for a C# API.
But now that I've discovered functional testing, I enjoy writing them.

With little to no setup required, the time spent on writing tests has been cut in half.
Whereas previously most of the time was spent (at least for me) on the setup of the test, and not the actual test itself.
The time spent on writing them feels more like time well spent.

If you follow the theory about a refactor, you shouldn't be changing your tests.
In practice, we found out (the hard way) that this is not always true.
Thus, this usually also meant regression bugs.
Because integration tests don't care about the implementation details, it should mean that you won't have to refactor or rewrite previously written tests.
This will give us, as maintainers of the codebase, more confidence when we change, move, and delete code.
The test itself will almost not change over time, which also trims down the time spent on the maintenance of these tests.

Does this mean I don't write unit tests?
No, it does not, but they are less written.
Only for real business logic that doesn't require dependencies, just input in and a result as output.

These integration tests might be slower to run, but it's worth it in my opinion.
Why? Because they give me more confidence that the code we ship, is actually working, the way it's intended to work.
We're not mocking or stubbing parts of the application, we're testing the whole application.
With machines being faster, there won't be much difference anyway between the other tests and the integration tests.
A couple of years ago, this time difference was higher, and this usually meant that fewer (or no) integration tests were written.
Time to change that, if you ask me!

The full example can be found on [GitHub](https://github.com/timdeschryver/HowToTestYourCsharpWebApi).

## More resources

- [The official docs about integration tests](https://docs.microsoft.com/en-us/aspnet/core/test/integration-tests)
- [Easier functional and integration testing of ASP.NET Core applications](https://www.hanselman.com/blog/EasierFunctionalAndIntegrationTestingOfASPNETCoreApplications.aspx) by [Scott Hanselman](https://twitter.com/shanselman)
- [Avoid In-Memory Databases for Tests](https://jimmybogard.com/avoid-in-memory-databases-for-tests/) by [Jimmy Bogard](https://twitter.com/jbogard)
